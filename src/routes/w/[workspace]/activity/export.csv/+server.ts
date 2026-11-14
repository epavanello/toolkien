import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { exportCsv, record } from '#lib/server/audit/index.ts';
import { ACTIVITY_RANGES, activityQuery, canSeeAllMembers } from '#lib/server/audit/scope.ts';
import { AUDIT_OUTCOMES } from '#lib/server/db/schema/index.ts';
import { requireWorkspace } from '#lib/server/guards.ts';
import type { RequestHandler } from './$types';

const params = z.object({
	userId: z.string().max(100).optional(),
	connectorId: z.string().max(100).optional(),
	outcome: z.enum(AUDIT_OUTCOMES).optional(),
	range: z.enum(ACTIVITY_RANGES).default('30d')
});

/** CSV export of the workspace activity (owners/admins with a second factor), metadata only */
export const GET: RequestHandler = async ({ params: route, url }) => {
	const { workspace, actor } = await requireWorkspace(route.workspace, 'admin');
	if (!(await canSeeAllMembers(workspace, actor))) {
		error(403, 'Add a passkey to export activity.', {
			code: 'SECOND_FACTOR_REQUIRED'
		});
	}
	const parsed = params.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) error(400, 'Invalid filters.', { code: 'INVALID_INPUT' });
	const csv = await exportCsv(activityQuery(actor, true, parsed.data));
	await record({
		type: 'audit.exported',
		outcome: 'success',
		workspaceId: workspace.id,
		userId: actor.userId,
		metadata: {
			range: parsed.data.range,
			filtered: !!(parsed.data.userId || parsed.data.connectorId || parsed.data.outcome)
		}
	});
	const day = new Date().toISOString().slice(0, 10);
	return new Response(csv, {
		headers: {
			'Content-Type': 'text/csv; charset=utf-8',
			'Content-Disposition': `attachment; filename="${workspace.slug}-activity-${day}.csv"`,
			'Cache-Control': 'no-store'
		}
	});
};
