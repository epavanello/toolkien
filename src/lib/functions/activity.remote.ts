import { query } from '$app/server';
import { z } from 'zod';
import { AUDIT_OUTCOMES } from '#lib/server/db/schema/index.ts';
import { timeline } from '#lib/server/audit/index.ts';
import { ACTIVITY_RANGES, activityQuery, canSeeAllMembers } from '#lib/server/audit/scope.ts';
import { list as listConnectors } from '#lib/server/connectors/index.ts';
import { requireWorkspace } from '#lib/server/guards.ts';
import { listMembers } from '#lib/server/workspaces/index.ts';

const filters = z.object({
	workspace: z.string().min(1).max(100),
	userId: z.string().max(100).optional(),
	connectorId: z.string().max(100).optional(),
	outcome: z.enum(AUDIT_OUTCOMES).optional(),
	range: z.enum(ACTIVITY_RANGES).default('7d'),
	limit: z.number().int().min(10).max(500).default(50)
});

const POLL_MS = 3000;

/**
 * Live activity timeline (grouped by execution). Re-queries every few seconds and yields only
 * when something changed. Members get their own events; admins everyone's.
 */
export const watchActivity = query.live(filters, async function* (input) {
	const { workspace, actor } = await requireWorkspace(input.workspace);
	const allMembers = await canSeeAllMembers(workspace, actor);
	const q = { ...activityQuery(actor, allMembers, input), limit: input.limit };
	let last = '';
	while (true) {
		const result = await timeline(q);
		const signature = JSON.stringify(result);
		if (signature !== last) {
			last = signature;
			yield { ...result, allMembers };
		}
		await new Promise((resolve) => setTimeout(resolve, POLL_MS));
	}
});

/** Options of the filter bar: connectors the viewer can see, members for admins */
export const getActivityFilters = query(z.string().min(1).max(100), async (slug) => {
	const { workspace, actor } = await requireWorkspace(slug);
	const allMembers = await canSeeAllMembers(workspace, actor);
	const [connectors, members] = await Promise.all([
		listConnectors(actor).catch(() => []),
		allMembers ? listMembers(actor) : []
	]);
	return {
		allMembers,
		isAdmin: workspace.role !== 'member',
		connectors: connectors.map((c) => ({ value: c.id, label: c.name })),
		members: members.map((m) => ({ value: m.userId, label: m.name }))
	};
});
