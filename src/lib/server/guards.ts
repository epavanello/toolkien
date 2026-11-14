import { getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';
import { getBySlug, hasRole } from '#lib/server/workspaces/index.ts';
import type {
	WorkspaceActor,
	WorkspaceRole,
	WorkspaceSummary
} from '#lib/server/workspaces/types.ts';

/**
 * Server-side guards for remote functions and loads. Call them first thing; they throw an
 * `App.Error` with a code, so callers never handle the failure themselves.
 */

/** The signed-in (cookie) user, or 401 */
export function requireUser() {
	const { locals } = getRequestEvent();
	if (!locals.user) error(401, 'Sign in to continue.', { code: 'UNAUTHORIZED' });
	return locals.user;
}

/**
 * Membership of the signed-in user in the workspace with this slug, with at least `minRole`.
 * Returns the workspace and the `WorkspaceActor` every service call takes. 404 (not 403) for
 * non-members, so workspace slugs cannot be probed.
 */
export async function requireWorkspace(
	slug: string,
	minRole: WorkspaceRole = 'member'
): Promise<{ workspace: WorkspaceSummary; actor: WorkspaceActor }> {
	const user = requireUser();
	const workspace = await getBySlug(user.id, slug);
	if (!workspace) error(404, 'Workspace not found.', { code: 'NOT_FOUND' });
	if (!hasRole(workspace.role, minRole)) {
		error(403, 'You do not have access to this action.', { code: 'FORBIDDEN' });
	}
	return {
		workspace,
		actor: { workspaceId: workspace.id, userId: user.id, role: workspace.role }
	};
}
