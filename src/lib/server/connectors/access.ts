import { error } from '@sveltejs/kit';
import { and, eq, isNull, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { connector } from '#lib/server/db/schema/index.ts';
import type { WorkspaceActor } from '#lib/server/workspaces/types.ts';

/**
 * Who sees and manages which connector:
 * - visible: shared/admin-configured ones (`owner_user_id IS NULL`) and the actor's own;
 * - manage (edit, remove, refresh): admins and owners for workspace connectors, the owner for
 *   personal-only ones (admins too, for cleanup);
 * - authenticate: `shared` → admins (one credential for everyone); `personal` → every member,
 *   each for their own account.
 */

export type ConnectorRow = typeof connector.$inferSelect;

export const isAdmin = (actor: WorkspaceActor) => actor.role === 'owner' || actor.role === 'admin';

export const visibleTo = (actor: WorkspaceActor) =>
	and(
		eq(connector.workspaceId, actor.workspaceId),
		or(isNull(connector.ownerUserId), eq(connector.ownerUserId, actor.userId))
	);

export const canManage = (actor: WorkspaceActor, row: ConnectorRow) =>
	isAdmin(actor) || (row.ownerUserId !== null && row.ownerUserId === actor.userId);

export const canAuthenticate = (actor: WorkspaceActor, row: ConnectorRow) =>
	row.scope === 'shared' ? isAdmin(actor) : true;

/** Owner of the credential the actor uses: `null` = the shared credential */
export const credentialUserId = (actor: WorkspaceActor, row: ConnectorRow) =>
	row.scope === 'shared' ? null : actor.userId;

/** The connector if the actor can see it, else 404 (no probing of ids across workspaces) */
export async function getVisible(
	actor: WorkspaceActor,
	connectorId: string
): Promise<ConnectorRow> {
	const [row] = await db
		.select()
		.from(connector)
		.where(and(eq(connector.id, connectorId), visibleTo(actor)))
		.limit(1);
	if (!row) error(404, 'Connector not found.', { code: 'NOT_FOUND' });
	return row;
}

export function assertCanManage(actor: WorkspaceActor, row: ConnectorRow) {
	if (!canManage(actor, row)) {
		error(403, 'Only workspace admins can change this connector.', { code: 'FORBIDDEN' });
	}
}

export function assertCanAuthenticate(actor: WorkspaceActor, row: ConnectorRow) {
	if (!canAuthenticate(actor, row)) {
		error(403, 'Only workspace admins can authenticate a shared connector.', { code: 'FORBIDDEN' });
	}
}
