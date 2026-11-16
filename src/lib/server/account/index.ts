import { error } from '@sveltejs/kit';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import {
	anonymizeUser,
	deleteForWorkspaces,
	listForUser,
	record
} from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import {
	connector,
	connectorCredential,
	mcpActiveWorkspace,
	mcpClientInfo,
	mcpClientLabel,
	member,
	oauthClient,
	oauthConsent,
	organization,
	passkey,
	permissionLevel,
	session,
	user
} from '#lib/server/db/schema/index.ts';
import { deleteWorkspaceNow, removeMemberConnectors } from '#lib/server/workspaces/index.ts';
import type { WorkspaceRole } from '#lib/server/workspaces/types.ts';
import type { AccountExport, DeletionBlocker } from './types.ts';

export type * from './types.ts';

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);
const role = (value: string): WorkspaceRole =>
	value === 'owner' || value === 'admin' ? value : 'member';

/** Everything Toolkien stores about the user, as JSON metadata (records `account.exported`) */
export async function exportAccount(userId: string): Promise<AccountExport> {
	const [account] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
	if (!account) error(404, 'Account not found.', { code: 'NOT_FOUND' });

	const [
		passkeys,
		sessions,
		workspaces,
		connectors,
		credentials,
		permissions,
		consents,
		active,
		events
	] = await Promise.all([
		db.select().from(passkey).where(eq(passkey.userId, userId)),
		db.select().from(session).where(eq(session.userId, userId)),
		db
			.select({
				id: organization.id,
				name: organization.name,
				slug: organization.slug,
				kind: organization.kind,
				role: member.role,
				joinedAt: member.createdAt
			})
			.from(member)
			.innerJoin(organization, eq(organization.id, member.organizationId))
			.where(eq(member.userId, userId)),
		db.select().from(connector).where(eq(connector.ownerUserId, userId)),
		db.select().from(connectorCredential).where(eq(connectorCredential.userId, userId)),
		db.select().from(permissionLevel).where(eq(permissionLevel.userId, userId)),
		db
			.select({
				clientId: oauthConsent.clientId,
				name: oauthClient.name,
				clientInfo: mcpClientInfo.info,
				label: mcpClientLabel.label,
				createdAt: oauthConsent.createdAt
			})
			.from(oauthConsent)
			.leftJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
			.leftJoin(
				mcpClientInfo,
				and(
					eq(mcpClientInfo.clientId, oauthConsent.clientId),
					eq(mcpClientInfo.userId, oauthConsent.userId)
				)
			)
			.leftJoin(
				mcpClientLabel,
				and(
					eq(mcpClientLabel.clientId, oauthConsent.clientId),
					eq(mcpClientLabel.userId, oauthConsent.userId)
				)
			)
			.where(eq(oauthConsent.userId, userId)),
		db.select().from(mcpActiveWorkspace).where(eq(mcpActiveWorkspace.userId, userId)),
		listForUser(userId)
	]);

	await record({ type: 'account.exported', outcome: 'success', userId });
	return {
		format: 'toolkien-account-export',
		version: 1,
		exportedAt: new Date().toISOString(),
		account: {
			id: account.id,
			name: account.name,
			email: account.email,
			createdAt: account.createdAt.toISOString()
		},
		passkeys: passkeys.map((p) => ({
			name: p.name,
			deviceType: p.deviceType,
			createdAt: iso(p.createdAt)
		})),
		sessions: sessions.map((s) => ({
			createdAt: s.createdAt.toISOString(),
			expiresAt: s.expiresAt.toISOString(),
			ipAddress: s.ipAddress,
			userAgent: s.userAgent
		})),
		workspaces: workspaces.map((w) => ({
			...w,
			role: role(w.role),
			joinedAt: w.joinedAt.toISOString()
		})),
		connectors: connectors.map((c) => ({
			id: c.id,
			workspaceId: c.workspaceId,
			name: c.name,
			url: c.url,
			scope: c.scope,
			source: c.source,
			createdAt: c.createdAt.toISOString()
		})),
		credentials: credentials.map((c) => ({
			connectorId: c.connectorId,
			workspaceId: c.workspaceId,
			kind: c.kind,
			scope: c.scope,
			createdAt: c.createdAt.toISOString()
		})),
		permissions: permissions.map((p) => ({
			workspaceId: p.workspaceId,
			toolId: p.toolId,
			level: p.level,
			updatedAt: p.updatedAt.toISOString()
		})),
		mcpClients: consents.map((c) => ({
			clientId: c.clientId,
			name: c.name,
			clientInfo: c.clientInfo,
			label: c.label,
			consentedAt: c.createdAt.toISOString()
		})),
		activeWorkspaces: active.map((a) => ({ clientId: a.clientId, workspaceId: a.workspaceId })),
		auditEvents: events.map((e) => ({ ...e, occurredAt: e.occurredAt.toISOString() }))
	};
}

/** Company workspaces the user owns that still have other members */
export async function deletionBlockers(userId: string): Promise<DeletionBlocker[]> {
	const owned = await db
		.select({ workspaceId: organization.id, name: organization.name, slug: organization.slug })
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(
			and(eq(member.userId, userId), eq(member.role, 'owner'), eq(organization.kind, 'company'))
		);
	if (owned.length === 0) return [];
	const counts = await db
		.select({ workspaceId: member.organizationId, members: sql<number>`count(*)` })
		.from(member)
		.where(
			and(
				inArray(
					member.organizationId,
					owned.map((w) => w.workspaceId)
				),
				ne(member.userId, userId)
			)
		)
		.groupBy(member.organizationId);
	const others = new Map(counts.map((c) => [c.workspaceId, Number(c.members)]));
	return owned
		.filter((w) => (others.get(w.workspaceId) ?? 0) > 0)
		.map((w) => ({ ...w, members: others.get(w.workspaceId)! }));
}

/** Deletes the account (see the contract in `types.ts`) */
export async function deleteAccount(userId: string) {
	const blockers = await deletionBlockers(userId);
	if (blockers.length > 0) {
		error(
			409,
			`Transfer ownership of ${blockers.map((b) => b.name).join(', ')} or delete it first.`,
			{ code: 'CONFLICT' }
		);
	}
	const memberships = await db
		.select({ workspaceId: member.organizationId, role: member.role })
		.from(member)
		.where(eq(member.userId, userId));

	const owned = memberships.filter((m) => m.role === 'owner').map((m) => m.workspaceId);
	for (const workspaceId of owned) await deleteWorkspaceNow(workspaceId, 'account_deleted');

	for (const m of memberships.filter((m) => m.role !== 'owner')) {
		await removeMemberConnectors(
			{ workspaceId: m.workspaceId, userId, role: role(m.role) },
			{ includeCredentials: true }
		);
	}

	await deleteForWorkspaces(owned);
	await anonymizeUser(userId);
	await db.delete(user).where(eq(user.id, userId));
	await record({
		type: 'account.deleted',
		outcome: 'success',
		metadata: { workspacesDeleted: owned.length }
	});
}
