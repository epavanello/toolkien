/**
 * Audit log: who did what and when, never content (no arguments, results or script code).
 * Append-only: the custom migration adds a trigger that aborts UPDATE; DELETE is reserved to
 * the retention job (`AUDIT_RETENTION_DAYS`) and account anonymisation.
 */
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { createdAt, id, json } from './columns.ts';

export const AUDIT_EVENT_TYPES = [
	'auth.login',
	'auth.logout',
	'workspace.created',
	'workspace.switched',
	'workspace.policy_changed',
	'workspace.deletion_scheduled',
	'workspace.deleted',
	'workspace.updated',
	'workspace.deletion_cancelled',
	'workspace.ownership_transferred',
	'member.invited',
	'member.joined',
	'member.role_changed',
	'member.removed',
	'invite.revoked',
	'connector.added',
	'connector.authenticated',
	'connector.removed',
	'connector.synced',
	'connector.descriptions_changed',
	'permission.changed',
	'execution.started',
	'execution.paused',
	'execution.completed',
	'execution.failed',
	'execution.cancelled',
	'tool.called',
	/** An MCP client searched or described tools (`tools_search`, `tools_describe`): counts only */
	'tools.searched',
	'tools.described',
	'approval.requested',
	'approval.decided',
	'kill_switch.activated',
	'kill_switch.released',
	'mcp_client.revoked',
	/** The user renamed one of their MCP clients (`clientName` is the new name) */
	'mcp_client.renamed',
	'account.exported',
	'account.deleted',
	'platform.limits_changed',
	'audit.exported'
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export const AUDIT_OUTCOMES = ['success', 'failure', 'denied', 'pending'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** Who approved a call: the user, an admin, or a policy (`allow` level) */
export const APPROVED_BY = ['self', 'admin', 'policy'] as const;
export type ApprovedBy = (typeof APPROVED_BY)[number];

/**
 * No foreign keys on purpose: events outlive the rows they mention, and account deletion
 * anonymises them (`user_id` → null) instead of cascading.
 */
export const auditEvent = sqliteTable(
	'audit_event',
	{
		id: id(),
		occurredAt: createdAt('occurred_at'),
		type: text('type', { enum: AUDIT_EVENT_TYPES }).notNull(),
		workspaceId: text('workspace_id'),
		userId: text('user_id'),
		/** OAuth client id and display name (Claude, Codex, Cursor…) */
		clientId: text('client_id'),
		clientName: text('client_name'),
		/**
		 * MCP `clientInfo` of the request, `name version` (`claude-code 2.1.3`). Self-asserted by
		 * the client like the name: display only.
		 */
		clientInfo: text('client_info'),
		connectorId: text('connector_id'),
		/** `namespace.tool`, e.g. `github.createIssue` */
		toolPath: text('tool_path'),
		executionId: text('execution_id'),
		outcome: text('outcome', { enum: AUDIT_OUTCOMES }).notNull(),
		durationMs: integer('duration_ms'),
		approvedBy: text('approved_by', { enum: APPROVED_BY }),
		approverUserId: text('approver_user_id'),
		/** Extra content-free details (ids, counts, old/new level). Never arguments or results. */
		metadata: json<Record<string, string | number | boolean | null>>('metadata')
	},
	(t) => [
		index('audit_event_workspace_idx').on(t.workspaceId, t.occurredAt),
		index('audit_event_user_idx').on(t.userId, t.occurredAt),
		index('audit_event_execution_idx').on(t.executionId),
		index('audit_event_occurred_idx').on(t.occurredAt)
	]
);
