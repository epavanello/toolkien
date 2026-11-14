/**
 * Platform-wide settings, kill switches and usage metrics (pricing is free for now, but usage
 * is recorded per workspace from day one).
 */
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { user } from './auth.ts';
import { createdAt, id, json, timestamp, updatedAt } from './columns.ts';

/**
 * Key/value settings editable from the platform admin panel. Values override the env defaults,
 * e.g. `limits` → `{ execTimeoutMs, execMaxToolCalls, execMaxOutputBytes, rateLimitExecPerMin }`.
 */
export const platformSetting = sqliteTable('platform_setting', {
	key: text('key').primaryKey(),
	value: json<unknown>('value').notNull(),
	updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
	updatedAt: updatedAt()
});

export const KILL_SWITCH_SCOPES = ['user', 'workspace', 'platform'] as const;
export type KillSwitchScope = (typeof KILL_SWITCH_SCOPES)[number];

/**
 * Who pulled the switch: a workspace admin (from workspace settings, they may release it) or a
 * platform admin (only platform admins release it).
 */
export const KILL_SWITCH_ORIGINS = ['workspace_admin', 'platform_admin'] as const;
export type KillSwitchOrigin = (typeof KILL_SWITCH_ORIGINS)[number];

/**
 * Kill switches at three levels. An active switch (no `releasedAt`) revokes sessions, client
 * OAuth tokens and running executions in its scope; connectors stay configured but suspended.
 * `targetId` is the user or workspace id, null for `platform`.
 */
export const killSwitch = sqliteTable(
	'kill_switch',
	{
		id: id(),
		scope: text('scope', { enum: KILL_SWITCH_SCOPES }).notNull(),
		targetId: text('target_id'),
		reason: text('reason').notNull(),
		origin: text('origin', { enum: KILL_SWITCH_ORIGINS }).notNull().default('platform_admin'),
		activatedBy: text('activated_by').references(() => user.id, { onDelete: 'set null' }),
		activatedAt: createdAt('activated_at'),
		releasedBy: text('released_by').references(() => user.id, { onDelete: 'set null' }),
		releasedAt: timestamp('released_at')
	},
	(t) => [index('kill_switch_target_idx').on(t.scope, t.targetId, t.releasedAt)]
);

/** Daily counters per workspace (UTC day), upserted by the executions module */
export const usageDaily = sqliteTable(
	'usage_daily',
	{
		workspaceId: text('workspace_id').notNull(),
		/** `YYYY-MM-DD` (UTC) */
		day: text('day').notNull(),
		executions: integer('executions').notNull().default(0),
		failedExecutions: integer('failed_executions').notNull().default(0),
		toolCalls: integer('tool_calls').notNull().default(0),
		approvalsRequested: integer('approvals_requested').notNull().default(0),
		executionMs: integer('execution_ms').notNull().default(0)
	},
	(t) => [primaryKey({ columns: [t.workspaceId, t.day] })]
);
