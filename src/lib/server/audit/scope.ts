/**
 * Who sees what in the activity views (kept out of `index.ts`: it depends on the workspaces
 * module, which itself records audit events).
 *
 * - Members see only their own events.
 * - Owners/admins see every member's events, with a user filter and CSV export, once they have a
 *   second factor in company workspaces (personal workspaces have a single member).
 */
import { hasRole, hasSecondFactor } from '#lib/server/workspaces/index.ts';
import type { WorkspaceActor, WorkspaceSummary } from '#lib/server/workspaces/types.ts';
import type { AuditOutcome, AuditQuery } from './types.ts';

export const ACTIVITY_RANGES = ['24h', '7d', '30d', '90d', 'all'] as const;
export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

export type ActivityFilterInput = {
	userId?: string;
	connectorId?: string;
	outcome?: AuditOutcome;
	range?: ActivityRange;
};

const RANGE_MS: Record<ActivityRange, number | null> = {
	'24h': 24 * 3600_000,
	'7d': 7 * 24 * 3600_000,
	'30d': 30 * 24 * 3600_000,
	'90d': 90 * 24 * 3600_000,
	all: null
};

export async function canSeeAllMembers(workspace: WorkspaceSummary, actor: WorkspaceActor) {
	if (!hasRole(workspace.role, 'admin')) return false;
	return workspace.kind === 'personal' || (await hasSecondFactor(actor.userId));
}

/** Pure: the audit query for a viewer and filters (members forced to their own events) */
export function activityQuery(
	actor: WorkspaceActor,
	allMembers: boolean,
	filters: ActivityFilterInput,
	now = new Date()
): Omit<AuditQuery, 'cursor' | 'limit'> {
	const span = RANGE_MS[filters.range ?? '7d'];
	return {
		workspaceId: actor.workspaceId,
		userId: allMembers ? filters.userId || undefined : actor.userId,
		connectorId: filters.connectorId || undefined,
		outcome: filters.outcome,
		from: span ? new Date(now.getTime() - span) : undefined
	};
}
