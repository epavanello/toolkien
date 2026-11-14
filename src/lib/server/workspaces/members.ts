import { error } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import {
	connector,
	connectorCredential,
	mcpActiveWorkspace,
	member,
	passkey,
	user
} from '#lib/server/db/schema/index.ts';
import {
	assertCompanyAdminAction,
	hasRole,
	hasSecondFactor,
	loadWorkspace,
	secondFactorError,
	toRole
} from './core.ts';
import type { GrantableRole, MemberSummary, WorkspaceActor } from './types.ts';

/** Members of the actor's workspace; passkey status only for admins */
export async function listMembers(actor: WorkspaceActor): Promise<MemberSummary[]> {
	const workspace = await loadWorkspace(actor);
	const rows = await db
		.select({
			userId: member.userId,
			memberId: member.id,
			name: user.name,
			email: user.email,
			role: member.role,
			joinedAt: member.createdAt
		})
		.from(member)
		.innerJoin(user, eq(user.id, member.userId))
		.where(eq(member.organizationId, actor.workspaceId))
		.orderBy(asc(user.name));

	const isAdmin = hasRole(workspace.role, 'admin');
	const withPasskey = isAdmin
		? new Set(
				(
					await db
						.selectDistinct({ userId: passkey.userId })
						.from(passkey)
						.where(
							inArray(
								passkey.userId,
								rows.map((row) => row.userId)
							)
						)
				).map((row) => row.userId)
			)
		: new Set<string>();

	return rows.map((row) => ({
		...row,
		role: toRole(row.role),
		secondFactor: isAdmin ? withPasskey.has(row.userId) : null
	}));
}

async function findMember(workspaceId: string, userId: string) {
	const [row] = await db
		.select({ id: member.id, role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)))
		.limit(1);
	if (!row) error(404, 'Member not found.', { code: 'NOT_FOUND' });
	return { id: row.id, role: toRole(row.role) };
}

/**
 * Admins change any non-owner role between `member` and `admin`. Granting `admin` requires the
 * target to have a passkey. `owner` moves only with `transferOwnership`.
 */
export async function changeRole(actor: WorkspaceActor, targetUserId: string, role: GrantableRole) {
	await assertCompanyAdminAction(actor);
	const target = await findMember(actor.workspaceId, targetUserId);
	if (target.role === 'owner') {
		error(400, 'Transfer ownership to change the owner role.', { code: 'INVALID_INPUT' });
	}
	if (target.role === role) return;
	if (role === 'admin' && !(await hasSecondFactor(targetUserId))) {
		secondFactorError('This member needs a passkey to become an admin.');
	}
	await db.update(member).set({ role }).where(eq(member.id, target.id));
	await record({
		type: 'member.role_changed',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		metadata: { memberId: target.id, from: target.role, to: role }
	});
}

/**
 * Removes a member (admins) or leaves the workspace (self). The owner can do neither: they
 * transfer ownership first. The member's own connectors and credentials in this workspace are
 * deleted; shared connectors stay.
 */
export async function removeMember(actor: WorkspaceActor, targetUserId: string) {
	const self = targetUserId === actor.userId;
	if (self) {
		const workspace = await loadWorkspace(actor);
		if (workspace.kind === 'personal' || workspace.role === 'owner') {
			error(400, 'The owner cannot leave. Transfer ownership first.', { code: 'INVALID_INPUT' });
		}
	} else {
		await assertCompanyAdminAction(actor);
	}
	const target = await findMember(actor.workspaceId, targetUserId);
	if (target.role === 'owner') {
		error(400, 'The owner cannot be removed.', { code: 'INVALID_INPUT' });
	}

	await removeMemberConnectors(
		{ workspaceId: actor.workspaceId, userId: targetUserId, role: target.role },
		{ includeCredentials: true }
	);
	await db.batch([
		db.delete(member).where(eq(member.id, target.id)),
		db
			.delete(mcpActiveWorkspace)
			.where(
				and(
					eq(mcpActiveWorkspace.userId, targetUserId),
					eq(mcpActiveWorkspace.workspaceId, actor.workspaceId)
				)
			)
	]);
	await record({
		type: 'member.removed',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		metadata: { memberId: target.id, self }
	});
}

/**
 * Removes the connectors a member added only for themselves (through the connectors contract,
 * which revokes upstream tokens where possible) and, optionally, their own credentials on shared
 * "personal" connectors. Best effort: a failing upstream revocation never blocks the removal.
 */
export async function removeMemberConnectors(
	memberActor: WorkspaceActor,
	{ includeCredentials }: { includeCredentials: boolean }
) {
	const owned = await db
		.select({ id: connector.id })
		.from(connector)
		.where(
			and(
				eq(connector.workspaceId, memberActor.workspaceId),
				eq(connector.ownerUserId, memberActor.userId)
			)
		);
	if (owned.length > 0) {
		const connectors = await import('#lib/server/connectors/index.ts');
		for (const { id } of owned) {
			try {
				await connectors.remove(memberActor, id);
			} catch {
				console.error('[workspaces] connector removal failed, deleting locally');
				await db.delete(connector).where(eq(connector.id, id));
			}
		}
	}
	if (includeCredentials) {
		// Their credentials on shared "personal" connectors: revoked upstream, then deleted
		const connectors = await import('#lib/server/connectors/index.ts');
		try {
			await connectors.revokeUserCredentials(memberActor.workspaceId, memberActor.userId);
		} catch {
			console.error('[workspaces] credential revocation failed, deleting locally');
			await db
				.delete(connectorCredential)
				.where(
					and(
						eq(connectorCredential.workspaceId, memberActor.workspaceId),
						eq(connectorCredential.userId, memberActor.userId)
					)
				);
		}
	}
}

/**
 * The owner hands the workspace to another member, who must have a passkey. The old
 * owner becomes an admin.
 */
export async function transferOwnership(actor: WorkspaceActor, targetUserId: string) {
	await assertCompanyAdminAction(actor, 'owner');
	if (targetUserId === actor.userId) return;
	const target = await findMember(actor.workspaceId, targetUserId);
	const current = await findMember(actor.workspaceId, actor.userId);
	if (!(await hasSecondFactor(targetUserId))) {
		secondFactorError('The new owner needs a passkey first.');
	}
	await db.batch([
		db.update(member).set({ role: 'owner' }).where(eq(member.id, target.id)),
		db.update(member).set({ role: 'admin' }).where(eq(member.id, current.id))
	]);
	await record({
		type: 'workspace.ownership_transferred',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		metadata: { fromMemberId: current.id, toMemberId: target.id }
	});
}
