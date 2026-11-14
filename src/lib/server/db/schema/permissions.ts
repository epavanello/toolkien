/**
 * Per-tool permission levels. Two kinds of rows share the table:
 * - `user_id IS NULL`: workspace floor set by an admin (enforced minimum, members cannot loosen)
 * - `user_id` set: the member's own choice
 * The effective level is the most restrictive of the defaults, workspace policy, workspace row
 * and user row (`block` > `ask` > `allow`); see `#lib/server/permissions`.
 */
import { sql } from 'drizzle-orm';
import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization, user } from './auth.ts';
import { createdAt, id, updatedAt } from './columns.ts';
import { tool } from './connectors.ts';
import { PERMISSION_LEVELS } from './workspaces.ts';

export const permissionLevel = sqliteTable(
	'permission_level',
	{
		id: id(),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		toolId: text('tool_id')
			.notNull()
			.references(() => tool.id, { onDelete: 'cascade' }),
		level: text('level', { enum: PERMISSION_LEVELS }).notNull(),
		/**
		 * `tool_version.signature_hash` the level was confirmed against. When the tool's current
		 * signature differs (or this is null for an unverified tool) the setting is "to confirm"
		 * and the bridge treats the tool as `ask`.
		 */
		confirmedSignatureHash: text('confirmed_signature_hash'),
		setBy: text('set_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('permission_level_workspace_uq')
			.on(t.workspaceId, t.toolId)
			.where(sql`user_id is null`),
		uniqueIndex('permission_level_user_uq')
			.on(t.workspaceId, t.toolId, t.userId)
			.where(sql`user_id is not null`),
		index('permission_level_user_idx').on(t.workspaceId, t.userId)
	]
);
