import { error } from '@sveltejs/kit';
import { and, desc, eq, inArray, isNull, notInArray, type SQL } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import {
	connector,
	execution,
	killSwitch,
	oauthAccessToken,
	oauthRefreshToken,
	organization,
	session,
	user
} from '#lib/server/db/schema/index.ts';
import { isPlatformAdminEmail } from './admins.ts';
import type {
	ActivateKillSwitchInput,
	KillSwitchListener,
	KillSwitchSummary,
	LimitsService,
	SuspensionScope
} from './types.ts';

type ActiveSwitch = { id: string; scope: KillSwitchSummary['scope']; targetId: string | null };

const CACHE_MS = 15_000;
let cache: { at: number; active: ActiveSwitch[] } | null = null;
const listeners = new Set<KillSwitchListener>();

/** Subscribe to activations (e.g. to abort in-flight runner jobs); returns the unsubscribe */
export function onKillSwitch(listener: KillSwitchListener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

async function activeSwitches(): Promise<ActiveSwitch[]> {
	if (cache && Date.now() - cache.at < CACHE_MS) return cache.active;
	const active = await db
		.select({ id: killSwitch.id, scope: killSwitch.scope, targetId: killSwitch.targetId })
		.from(killSwitch)
		.where(isNull(killSwitch.releasedAt));
	cache = { at: Date.now(), active };
	return active;
}

export const invalidateKillSwitchCache = () => (cache = null);

const suspended = (message: string): never => error(403, message, { code: 'SUSPENDED' });

/**
 * Checked before every execution and every bridge call: platform, user and workspace switches,
 * workspaces scheduled for deletion and suspended connectors.
 */
export const assertNotSuspended: LimitsService['assertNotSuspended'] = async (scope) => {
	const active = await activeSwitches();
	if (active.some((s) => s.scope === 'platform')) {
		suspended('Toolkien is temporarily paused by its operators.');
	}
	if (scope.userId && active.some((s) => s.scope === 'user' && s.targetId === scope.userId)) {
		suspended('This account is suspended.');
	}
	if (scope.workspaceId) {
		if (active.some((s) => s.scope === 'workspace' && s.targetId === scope.workspaceId)) {
			suspended('This workspace is suspended by its admins or the operators.');
		}
		const [workspace] = await db
			.select({
				suspendedAt: organization.suspendedAt,
				deleteScheduledAt: organization.deleteScheduledAt
			})
			.from(organization)
			.where(eq(organization.id, scope.workspaceId))
			.limit(1);
		if (workspace?.deleteScheduledAt) suspended('This workspace is scheduled for deletion.');
		if (workspace?.suspendedAt) suspended('This workspace is suspended.');
	}
	if (scope.connectorId) {
		const [row] = await db
			.select({ suspendedAt: connector.suspendedAt })
			.from(connector)
			.where(eq(connector.id, scope.connectorId))
			.limit(1);
		if (row?.suspendedAt) suspended('This connector is suspended.');
	}
};

/**
 * Cancels running and paused executions in scope through the executions contract (best effort:
 * a failure is logged and the next bridge call is refused by `assertNotSuspended` anyway).
 */
export async function cancelExecutionsInScope(scope: SuspensionScope & { all?: boolean }) {
	const where: SQL[] = [inArray(execution.status, ['running', 'paused'])];
	if (scope.userId) where.push(eq(execution.userId, scope.userId));
	if (scope.workspaceId) where.push(eq(execution.workspaceId, scope.workspaceId));
	if (!scope.all && !scope.userId && !scope.workspaceId) return 0;
	const executions = await import('#lib/server/executions/index.ts');
	// In-flight runner jobs on this instance stop at once…
	try {
		executions.abortRunning(
			scope.all ? {} : { userId: scope.userId, workspaceId: scope.workspaceId }
		);
	} catch {
		console.error('[limits] could not abort running executions during a kill switch');
	}
	// …and every running or paused execution in scope is cancelled (state wiped)
	const rows = await db
		.select({ id: execution.id, userId: execution.userId })
		.from(execution)
		.where(and(...where));
	if (rows.length === 0) return 0;
	let cancelled = 0;
	for (const row of rows) {
		try {
			await executions.cancel({ userId: row.userId, executionId: row.id });
			cancelled++;
		} catch {
			console.error('[limits] could not cancel an execution during a kill switch');
		}
	}
	return cancelled;
}

/** Revokes MCP client tokens (access + refresh) of one user, or of everyone */
async function revokeOAuthTokens(userId: string | null) {
	const now = new Date();
	await db
		.update(oauthAccessToken)
		.set({ revoked: now })
		.where(
			and(
				isNull(oauthAccessToken.revoked),
				userId ? eq(oauthAccessToken.userId, userId) : undefined
			)
		);
	await db
		.update(oauthRefreshToken)
		.set({ revoked: now })
		.where(
			and(
				isNull(oauthRefreshToken.revoked),
				userId ? eq(oauthRefreshToken.userId, userId) : undefined
			)
		);
}

async function platformAdminIds() {
	const rows = await db.select({ id: user.id, email: user.email }).from(user);
	return rows.filter((row) => isPlatformAdminEmail(row.email)).map((row) => row.id);
}

/**
 * Activates a kill switch. Effects by scope:
 * - user: account suspended (treated as signed out), sessions and MCP tokens revoked, their own
 *   connectors suspended, executions cancelled;
 * - workspace: workspace suspended, its connectors suspended, executions cancelled (members keep
 *   their sessions: they can still read logs and settings, nothing runs);
 * - platform: every MCP token revoked, every session except platform admins' revoked, every
 *   execution cancelled. Connectors are not touched (the check above refuses everything).
 * Connectors stay configured; they get `suspendedAt = activatedAt` so release restores exactly
 * the ones this switch suspended.
 */
export async function activateKillSwitch(input: ActivateKillSwitchInput) {
	const reason = input.reason.trim().slice(0, 500);
	if (!reason) error(400, 'Give a reason.', { code: 'INVALID_INPUT' });
	if (input.scope !== 'platform' && !input.targetId) {
		error(400, 'Missing target.', { code: 'INVALID_INPUT' });
	}
	const targetId = input.scope === 'platform' ? null : input.targetId!;
	const existing = (await activeSwitches()).find(
		(s) => s.scope === input.scope && s.targetId === targetId
	);
	if (existing) return existing.id;

	const activatedAt = new Date();
	const [row] = await db
		.insert(killSwitch)
		.values({
			scope: input.scope,
			targetId,
			reason,
			origin: input.origin,
			activatedBy: input.actorUserId,
			activatedAt
		})
		.returning({ id: killSwitch.id });
	invalidateKillSwitchCache();

	if (input.scope === 'user') {
		await db.update(user).set({ suspendedAt: activatedAt }).where(eq(user.id, targetId!));
		await db.delete(session).where(eq(session.userId, targetId!));
		await revokeOAuthTokens(targetId);
		await db
			.update(connector)
			.set({ suspendedAt: activatedAt })
			.where(and(eq(connector.ownerUserId, targetId!), isNull(connector.suspendedAt)));
	} else if (input.scope === 'workspace') {
		await db
			.update(organization)
			.set({ suspendedAt: activatedAt })
			.where(eq(organization.id, targetId!));
		await db
			.update(connector)
			.set({ suspendedAt: activatedAt })
			.where(and(eq(connector.workspaceId, targetId!), isNull(connector.suspendedAt)));
	} else {
		const admins = await platformAdminIds();
		await db
			.delete(session)
			.where(admins.length > 0 ? notInArray(session.userId, admins) : undefined);
		await revokeOAuthTokens(null);
	}

	const scope =
		input.scope === 'user'
			? { userId: targetId! }
			: input.scope === 'workspace'
				? { workspaceId: targetId! }
				: { platform: true };
	for (const listener of listeners) {
		try {
			listener(scope);
		} catch {
			console.error('[limits] kill switch listener failed');
		}
	}
	await cancelExecutionsInScope(input.scope === 'platform' ? { all: true } : scope);
	await record({
		type: 'kill_switch.activated',
		outcome: 'success',
		userId: input.actorUserId,
		workspaceId: input.scope === 'workspace' ? targetId : null,
		metadata: { switchId: row.id, scope: input.scope, origin: input.origin }
	});
	return row.id;
}

/**
 * Releases a switch. A switch pulled by a platform admin can only be released by a platform
 * admin (`asPlatformAdmin`); workspace admins release only their workspace's own switches.
 */
export async function releaseKillSwitch(input: {
	id: string;
	actorUserId: string;
	asPlatformAdmin: boolean;
	/** Workspace admins: the workspace they act in */
	workspaceId?: string;
}) {
	const [row] = await db.select().from(killSwitch).where(eq(killSwitch.id, input.id)).limit(1);
	if (!row || row.releasedAt) error(404, 'Kill switch not found.', { code: 'NOT_FOUND' });
	if (!input.asPlatformAdmin) {
		if (
			row.origin !== 'workspace_admin' ||
			row.scope !== 'workspace' ||
			row.targetId !== input.workspaceId
		) {
			error(403, 'Only the operators can lift this suspension.', { code: 'FORBIDDEN' });
		}
	}
	await db
		.update(killSwitch)
		.set({ releasedAt: new Date(), releasedBy: input.actorUserId })
		.where(eq(killSwitch.id, row.id));
	invalidateKillSwitchCache();

	if (row.scope === 'user' && row.targetId) {
		await db.update(user).set({ suspendedAt: null }).where(eq(user.id, row.targetId));
		await db
			.update(connector)
			.set({ suspendedAt: null })
			.where(
				and(eq(connector.ownerUserId, row.targetId), eq(connector.suspendedAt, row.activatedAt))
			);
	} else if (row.scope === 'workspace' && row.targetId) {
		await db
			.update(organization)
			.set({ suspendedAt: null })
			.where(eq(organization.id, row.targetId));
		await db
			.update(connector)
			.set({ suspendedAt: null })
			.where(
				and(eq(connector.workspaceId, row.targetId), eq(connector.suspendedAt, row.activatedAt))
			);
	}
	await record({
		type: 'kill_switch.released',
		outcome: 'success',
		userId: input.actorUserId,
		workspaceId: row.scope === 'workspace' ? row.targetId : null,
		metadata: { switchId: row.id, scope: row.scope }
	});
}

/** Switches, newest first; `workspaceId` narrows to one workspace's switches */
export async function listKillSwitches(
	options: { activeOnly?: boolean; workspaceId?: string; limit?: number } = {}
): Promise<KillSwitchSummary[]> {
	const where: (SQL | undefined)[] = [];
	if (options.activeOnly) where.push(isNull(killSwitch.releasedAt));
	if (options.workspaceId) {
		where.push(
			and(eq(killSwitch.scope, 'workspace'), eq(killSwitch.targetId, options.workspaceId))
		);
	}
	const rows = await db
		.select({ row: killSwitch, activatedByName: user.name })
		.from(killSwitch)
		.leftJoin(user, eq(user.id, killSwitch.activatedBy))
		.where(and(...where))
		.orderBy(desc(killSwitch.activatedAt))
		.limit(options.limit ?? 100);

	const userIds = rows.filter((r) => r.row.scope === 'user').map((r) => r.row.targetId!);
	const workspaceIds = rows.filter((r) => r.row.scope === 'workspace').map((r) => r.row.targetId!);
	const labels = new Map<string, string>();
	if (userIds.length) {
		for (const u of await db
			.select({ id: user.id, email: user.email })
			.from(user)
			.where(inArray(user.id, userIds)))
			labels.set(u.id, u.email);
	}
	if (workspaceIds.length) {
		for (const w of await db
			.select({ id: organization.id, name: organization.name })
			.from(organization)
			.where(inArray(organization.id, workspaceIds)))
			labels.set(w.id, w.name);
	}
	return rows.map(({ row, activatedByName }) => ({
		id: row.id,
		scope: row.scope,
		targetId: row.targetId,
		targetLabel: row.targetId ? (labels.get(row.targetId) ?? null) : null,
		reason: row.reason,
		origin: row.origin,
		activatedAt: row.activatedAt,
		activatedByName,
		releasedAt: row.releasedAt
	}));
}
