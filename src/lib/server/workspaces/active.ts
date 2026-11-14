import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { mcpActiveWorkspace } from '#lib/server/db/schema/index.ts';
import { getById, listForUser } from './core.ts';
import type { WorkspacesService } from './types.ts';

export const getActiveWorkspace: WorkspacesService['getActiveWorkspace'] = async (
	userId,
	clientId
) => {
	const [row] = await db
		.select({ workspaceId: mcpActiveWorkspace.workspaceId })
		.from(mcpActiveWorkspace)
		.where(and(eq(mcpActiveWorkspace.userId, userId), eq(mcpActiveWorkspace.clientId, clientId)))
		.limit(1);
	if (row) {
		const stored = await getById(userId, row.workspaceId);
		if (stored) return stored;
	}
	const personal = (await listForUser(userId)).find((workspace) => workspace.kind === 'personal');
	if (!personal) error(404, 'No workspace found for this account.', { code: 'NOT_FOUND' });
	return personal;
};

/**
 * Stores the choice after the caller obtained explicit human confirmation; the caller records
 * the `workspace.switched` audit event (it knows the client name).
 */
export const setActiveWorkspace: WorkspacesService['setActiveWorkspace'] = async (
	userId,
	clientId,
	workspaceId
) => {
	const workspace = await getById(userId, workspaceId);
	if (!workspace) error(404, 'Workspace not found.', { code: 'NOT_FOUND' });
	await db
		.insert(mcpActiveWorkspace)
		.values({ userId, clientId, workspaceId })
		.onConflictDoUpdate({
			target: [mcpActiveWorkspace.userId, mcpActiveWorkspace.clientId],
			set: { workspaceId, updatedAt: new Date() }
		});
};
