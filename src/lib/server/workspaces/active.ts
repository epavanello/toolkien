import { error } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { mcpConnection } from '#lib/server/db/schema/index.ts';
import { getById, listForUser } from './core.ts';
import type { WorkspacesService } from './types.ts';

export const getActiveWorkspace: WorkspacesService['getActiveWorkspace'] = async (
	userId,
	connectionId
) => {
	const [row] = await db
		.select({ workspaceId: mcpConnection.workspaceId })
		.from(mcpConnection)
		.where(and(eq(mcpConnection.id, connectionId), eq(mcpConnection.userId, userId)))
		.limit(1);
	if (row?.workspaceId) {
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
	connectionId,
	workspaceId
) => {
	const workspace = await getById(userId, workspaceId);
	if (!workspace) error(404, 'Workspace not found.', { code: 'NOT_FOUND' });
	const updated = await db
		.update(mcpConnection)
		.set({ workspaceId, updatedAt: new Date() })
		.where(and(eq(mcpConnection.id, connectionId), eq(mcpConnection.userId, userId)))
		.returning({ id: mcpConnection.id });
	if (updated.length === 0) error(404, 'Connection not found.', { code: 'NOT_FOUND' });
};
