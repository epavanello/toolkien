/**
 * Durable executions. Script code, arguments and results are content: they exist only sealed
 * (workspace data key) and are wiped when the execution ends or expires. Every other column is
 * metadata. One execution belongs to exactly one workspace, forever.
 */
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization, user } from './auth.ts';
import { createdAt, id, sealed, timestamp, updatedAt } from './columns.ts';
import { tool } from './connectors.ts';

export const EXECUTION_STATUSES = [
	'running',
	'paused',
	'completed',
	'failed',
	'cancelled'
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_CALL_STATUSES = [
	'pending',
	'awaiting_approval',
	'completed',
	'failed',
	'rejected',
	'blocked'
] as const;
export type ExecutionCallStatus = (typeof EXECUTION_CALL_STATUSES)[number];

export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/** `once` = this call only; `tool_in_script` = every call to this tool in this execution */
export const APPROVAL_SCOPES = ['once', 'tool_in_script'] as const;
export type ApprovalScope = (typeof APPROVAL_SCOPES)[number];

export const execution = sqliteTable(
	'execution',
	{
		id: id(),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** OAuth client id of the MCP client that started it */
		clientId: text('client_id'),
		/** The MCP connection (`mcp_connection.id`) that started it, copied onto its audit events */
		connectionId: text('connection_id'),
		/**
		 * Display name (OAuth registration) and MCP `clientInfo` (`name version`) of that client,
		 * copied onto every audit event of the execution and shown with pending approvals.
		 * Self-asserted: display only.
		 */
		clientName: text('client_name'),
		clientInfo: text('client_info'),
		status: text('status', { enum: EXECUTION_STATUSES }).notNull().default('running'),
		/**
		 * Sealed durable state `{ code, approvals }` needed to re-run the script on resume.
		 * Cleared on completion, failure, cancellation and expiry.
		 */
		...sealed('state'),
		/** SHA-256 of the script, to refuse a resume with different code */
		codeHash: text('code_hash').notNull(),
		toolCallCount: integer('tool_call_count').notNull().default(0),
		/** Content-free failure category (`timeout`, `type_error`, `limit_tool_calls`, …) */
		errorCode: text('error_code'),
		durationMs: integer('duration_ms'),
		startedAt: createdAt('started_at'),
		finishedAt: timestamp('finished_at'),
		/** Paused executions expire (and their state is wiped) after this instant */
		expiresAt: timestamp('expires_at'),
		updatedAt: updatedAt()
	},
	(t) => [
		index('execution_workspace_idx').on(t.workspaceId, t.startedAt),
		index('execution_user_idx').on(t.userId, t.startedAt),
		index('execution_status_idx').on(t.status, t.expiresAt)
	]
);

/**
 * Tool calls of an execution by sequence number. On resume the script re-runs and calls with a
 * completed `seq` return the cached (sealed) result: writes are never repeated.
 */
export const executionCall = sqliteTable(
	'execution_call',
	{
		id: id(),
		executionId: text('execution_id')
			.notNull()
			.references(() => execution.id, { onDelete: 'cascade' }),
		seq: integer('seq').notNull(),
		toolId: text('tool_id').references(() => tool.id, { onDelete: 'set null' }),
		/** `namespace.tool` path the script called (metadata) */
		path: text('path').notNull(),
		status: text('status', { enum: EXECUTION_CALL_STATUSES }).notNull().default('pending'),
		/** Treated as a write (no `readOnlyHint`): never repeated once completed */
		isWrite: integer('is_write', { mode: 'boolean' }).notNull(),
		/** Sealed upstream result, replayed on resume; wiped with the execution state */
		...sealed('result'),
		durationMs: integer('duration_ms'),
		startedAt: createdAt('started_at'),
		finishedAt: timestamp('finished_at')
	},
	(t) => [uniqueIndex('execution_call_seq_uq').on(t.executionId, t.seq)]
);

/**
 * Human approvals. Decided only by a signed-in human (elicitation answer or the approval page),
 * never by the model: there is no MCP tool that approves. Pending approvals expire after 30 min.
 */
export const approval = sqliteTable(
	'approval',
	{
		id: id(),
		executionId: text('execution_id')
			.notNull()
			.references(() => execution.id, { onDelete: 'cascade' }),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		/** The user who must decide (the execution's user) */
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		callSeq: integer('call_seq').notNull(),
		toolId: text('tool_id').references(() => tool.id, { onDelete: 'set null' }),
		path: text('path').notNull(),
		status: text('status', { enum: APPROVAL_STATUSES }).notNull().default('pending'),
		/** Set on approval */
		scope: text('scope', { enum: APPROVAL_SCOPES }),
		channel: text('channel', { enum: ['elicitation', 'web'] }).notNull(),
		/** Sealed preview of the main arguments shown to the approver; wiped once decided */
		...sealed('preview'),
		decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
		decidedAt: timestamp('decided_at'),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: createdAt()
	},
	(t) => [
		index('approval_user_status_idx').on(t.userId, t.status),
		index('approval_execution_idx').on(t.executionId)
	]
);
