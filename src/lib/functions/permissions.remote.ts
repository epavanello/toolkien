import { command, query } from '$app/server';
import { z } from 'zod';
import { PERMISSION_LEVELS } from '#lib/server/db/schema/index.ts';
import { requireWorkspace } from '#lib/server/guards.ts';
import { listToolPermissions, setLevel, setLevels } from '#lib/server/permissions/index.ts';
import { hasRole } from '#lib/server/workspaces/index.ts';

const slug = z.string().trim().min(1).max(200);

/** Tools of the workspace with the viewer's levels (metadata only) */
export const listPermissions = query(slug, async (workspaceSlug) => {
	const { workspace, actor } = await requireWorkspace(workspaceSlug);
	return {
		/** Admins of company workspaces also set the workspace minimum per tool */
		canSetWorkspaceLevels: workspace.kind === 'company' && hasRole(workspace.role, 'admin'),
		tools: await listToolPermissions(actor)
	};
});

/**
 * Sets (and confirms against the current signature) the viewer's level, or, for admins, the
 * workspace minimum. Members can only tighten below the workspace minimum.
 */
export const setToolLevel = command(
	z.object({
		workspace: slug,
		toolId: z.string().min(1).max(100),
		level: z.enum(PERMISSION_LEVELS),
		scope: z.enum(['user', 'workspace'])
	}),
	async ({ workspace, toolId, level, scope }) => {
		const { actor } = await requireWorkspace(workspace, scope === 'workspace' ? 'admin' : 'member');
		await setLevel({
			workspaceId: actor.workspaceId,
			actorUserId: actor.userId,
			userId: scope === 'workspace' ? null : actor.userId,
			toolId,
			level
		});
		void listPermissions(workspace).refresh();
	}
);

/**
 * `setToolLevel` for many tools at once (a connector, or one operation type of it): same guard
 * and rules, all or nothing. `level: 'current'` confirms the level each tool has now. The UI
 * leaves out the tools whose minimum forbids the level and says so before asking.
 */
export const setToolLevels = command(
	z.object({
		workspace: slug,
		toolIds: z.array(z.string().min(1).max(100)).min(1).max(2000),
		level: z.enum([...PERMISSION_LEVELS, 'current']),
		scope: z.enum(['user', 'workspace'])
	}),
	async ({ workspace, toolIds, level, scope }) => {
		const { actor } = await requireWorkspace(workspace, scope === 'workspace' ? 'admin' : 'member');
		const result = await setLevels({
			workspaceId: actor.workspaceId,
			actorUserId: actor.userId,
			userId: scope === 'workspace' ? null : actor.userId,
			toolIds,
			level
		});
		void listPermissions(workspace).refresh();
		return result;
	}
);
