import { error } from '@sveltejs/kit';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import { connector, member, organization, workspacePolicy } from '#lib/server/db/schema/index.ts';
import { assertCompanyAdminAction, hasSecondFactor, secondFactorError, toRole } from './core.ts';
import { DELETION_GRACE_DAYS, type DeletionState, type WorkspaceActor } from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pure: when a workspace scheduled for deletion at `scheduledAt` is purged */
export const deletionDueAt = (scheduledAt: Date) =>
	new Date(scheduledAt.getTime() + DELETION_GRACE_DAYS * DAY_MS);

export const deletionState = (scheduledAt: Date | null): DeletionState =>
	scheduledAt ? { scheduledAt, purgeAt: deletionDueAt(scheduledAt) } : null;

/** `Acme Inc.` → `acme-inc-x7k2`: readable, unique, never the `personal-` prefix */
export function companySlug(name: string, suffix = randomSuffix()): string {
	const base =
		name
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 40)
			.replace(/^personal(-|$)/, 'team$1') || 'workspace';
	return `${base}-${suffix}`;
}

const randomSuffix = () =>
	Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => (b % 36).toString(36)).join('');

/**
 * Creates a company workspace owned by the user. The creator becomes owner, so they need 2FA or
 * a passkey first. Returns the new slug.
 */
export async function createWorkspace(userId: string, input: { name: string }) {
	const name = input.name.trim();
	if (!name || name.length > 80) {
		error(400, 'Enter a workspace name (up to 80 characters).', { code: 'INVALID_INPUT' });
	}
	if (!(await hasSecondFactor(userId))) {
		secondFactorError('Add a passkey before creating a company workspace.');
	}
	const workspaceId = crypto.randomUUID();
	const slug = companySlug(name);
	const now = new Date();
	await db.batch([
		db
			.insert(organization)
			.values({ id: workspaceId, name, slug, kind: 'company', createdAt: now }),
		db.insert(member).values({
			id: crypto.randomUUID(),
			organizationId: workspaceId,
			userId,
			role: 'owner',
			createdAt: now
		}),
		db.insert(workspacePolicy).values({ workspaceId, updatedBy: userId })
	]);
	await record({ type: 'workspace.created', outcome: 'success', workspaceId, userId });
	return { id: workspaceId, slug };
}

export async function renameWorkspace(actor: WorkspaceActor, input: { name: string }) {
	await assertCompanyAdminAction(actor);
	const name = input.name.trim();
	if (!name || name.length > 80) {
		error(400, 'Enter a workspace name (up to 80 characters).', { code: 'INVALID_INPUT' });
	}
	await db.update(organization).set({ name }).where(eq(organization.id, actor.workspaceId));
	await record({
		type: 'workspace.updated',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId
	});
}

/**
 * Owner only, company workspaces only, confirmed by typing the slug. Executions stop at once
 * (`assertNotSuspended` refuses scheduled workspaces); the purge job deletes everything after
 * `DELETION_GRACE_DAYS` unless the owner cancels.
 */
export async function scheduleDeletion(actor: WorkspaceActor, input: { confirm: string }) {
	const workspace = await assertCompanyAdminAction(actor, 'owner');
	if (input.confirm.trim() !== workspace.slug) {
		error(400, `Type ${workspace.slug} to confirm.`, { code: 'INVALID_INPUT' });
	}
	if (workspace.deleteScheduledAt) return deletionState(workspace.deleteScheduledAt)!;
	const scheduledAt = new Date();
	await db
		.update(organization)
		.set({ deleteScheduledAt: scheduledAt })
		.where(eq(organization.id, actor.workspaceId));
	await record({
		type: 'workspace.deletion_scheduled',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		metadata: { graceDays: DELETION_GRACE_DAYS }
	});
	try {
		const { cancelExecutionsInScope } = await import('#lib/server/limits/index.ts');
		await cancelExecutionsInScope({ workspaceId: actor.workspaceId });
	} catch {
		console.error('[workspaces] could not cancel executions of a workspace scheduled for deletion');
	}
	return deletionState(scheduledAt)!;
}

export async function cancelDeletion(actor: WorkspaceActor) {
	const workspace = await assertCompanyAdminAction(actor, 'owner');
	if (!workspace.deleteScheduledAt) return;
	await db
		.update(organization)
		.set({ deleteScheduledAt: null })
		.where(eq(organization.id, actor.workspaceId));
	await record({
		type: 'workspace.deletion_cancelled',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId
	});
}

/**
 * Hard delete: connectors are removed through the connectors contract (upstream revocation where
 * possible, best effort), then the organization row cascades to members, policy, invites,
 * connectors, credentials, executions and data keys. Audit events stay (no foreign key) until
 * the retention job removes them.
 */
export async function deleteWorkspaceNow(
	workspaceId: string,
	reason: 'grace_expired' | 'account_deleted'
) {
	const [owner] = await db
		.select({ userId: member.userId, role: member.role })
		.from(member)
		.where(and(eq(member.organizationId, workspaceId), eq(member.role, 'owner')))
		.limit(1);
	const connectors = await db
		.select({ id: connector.id, ownerUserId: connector.ownerUserId })
		.from(connector)
		.where(eq(connector.workspaceId, workspaceId));
	if (connectors.length > 0) {
		const service = await import('#lib/server/connectors/index.ts');
		for (const row of connectors) {
			const userId = row.ownerUserId ?? owner?.userId;
			if (!userId) continue;
			try {
				await service.remove(
					{
						workspaceId,
						userId,
						role: row.ownerUserId ? 'member' : toRole(owner?.role ?? 'owner')
					},
					row.id
				);
			} catch {
				console.error('[workspaces] upstream revocation failed during workspace deletion');
			}
		}
	}
	await db.delete(organization).where(eq(organization.id, workspaceId));
	await record({
		type: 'workspace.deleted',
		outcome: 'success',
		workspaceId,
		metadata: { reason }
	});
}

/** Job: purges workspaces whose grace period is over. Idempotent. */
export async function purgeScheduledDeletions(now = new Date()): Promise<number> {
	const cutoff = new Date(now.getTime() - DELETION_GRACE_DAYS * DAY_MS);
	const due = await db
		.select({ id: organization.id })
		.from(organization)
		.where(
			and(
				isNotNull(organization.deleteScheduledAt),
				lte(organization.deleteScheduledAt, cutoff),
				eq(organization.kind, 'company')
			)
		);
	for (const { id } of due) await deleteWorkspaceNow(id, 'grace_expired');
	return due.length;
}
