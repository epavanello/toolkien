import type { ApprovedBy, AuditEventType, AuditOutcome } from '#lib/server/db/schema/index.ts';

export type { ApprovedBy, AuditEventType, AuditOutcome };

/**
 * Audit contract (owner: org-ops). Who did what and when; NEVER content: no tool arguments,
 * results, script code, tokens or upstream error bodies. `metadata` holds ids, counts and enum
 * values only.
 *
 * - Append-only (a trigger rejects UPDATE). Rows older than `AUDIT_RETENTION_DAYS` are deleted
 *   by a daily job; account deletion anonymises `userId`.
 * - `record` must not make the caller fail: on a database error it logs the event type (no
 *   payload) and resolves.
 * - Members see their own events; admins and owners see the whole workspace (+ CSV export).
 */
export type AuditEventInput = {
	type: AuditEventType;
	outcome: AuditOutcome;
	workspaceId?: string | null;
	userId?: string | null;
	clientId?: string | null;
	/** (additive) The MCP connection (`mcp_connection.id`) the event came through, if any */
	connectionId?: string | null;
	/** OAuth registration name of the MCP client (self-asserted; display only) */
	clientName?: string | null;
	/** MCP `clientInfo` of the request, `name version` (self-asserted; display only) */
	clientInfo?: string | null;
	connectorId?: string | null;
	toolPath?: string | null;
	executionId?: string | null;
	durationMs?: number | null;
	approvedBy?: ApprovedBy | null;
	approverUserId?: string | null;
	metadata?: Record<string, string | number | boolean | null>;
};

export type AuditEvent = AuditEventInput & { id: string; occurredAt: Date };

export type AuditQuery = {
	workspaceId: string;
	/** Members are always forced to their own id by the caller */
	userId?: string;
	connectorId?: string;
	executionId?: string;
	outcome?: AuditOutcome;
	types?: AuditEventType[];
	from?: Date;
	to?: Date;
	/** Opaque cursor from the previous page */
	cursor?: string;
	limit?: number;
};

export interface AuditService {
	record(event: AuditEventInput): Promise<void>;
	query(query: AuditQuery): Promise<{ events: AuditEvent[]; nextCursor: string | null }>;
	/** Retention job: deletes events older than `days`; returns how many */
	purgeOlderThan(days: number): Promise<number>;
}

// ─── Org-ops extensions (additive) ──────────────────────────────────────────

/**
 * Technical server logs (stdout/stderr) are separate from this audit log: they carry no personal
 * data beyond ids, never content, and are kept 14 days by the container log rotation
 * (see `docs/notes/org-ops.md` → Logs). This module only handles the audit trail.
 */
export const TECHNICAL_LOG_RETENTION_DAYS = 14;

/** An event as the activity views show it: with the acting user's display name */
export type AuditEventView = AuditEvent & { userName: string | null };

/** Filters a page can send; the workspace and the user scope come from the guard */
export type ActivityFilters = {
	userId?: string;
	connectorId?: string;
	outcome?: AuditOutcome;
	types?: AuditEventType[];
	from?: Date;
	to?: Date;
};

/**
 * One row of the activity timeline: an execution with its events (tool calls, approvals), or a
 * standalone event (login, permission change, member joined…).
 */
export type TimelineEntry =
	| {
			kind: 'execution';
			id: string;
			executionId: string;
			/** Earliest event of the execution */
			startedAt: Date;
			/** Latest event of the execution */
			lastAt: Date;
			/** Outcome of the final `execution.*` event, else of the latest event */
			outcome: AuditOutcome;
			/**
			 * Paused, and on whom it waits: the human (an approval is unanswered) or the agent
			 * (every approval answered; it resumes when the agent calls `execution_status`)
			 */
			awaiting: 'approval' | 'agent' | null;
			userId: string | null;
			userName: string | null;
			clientName: string | null;
			clientInfo: string | null;
			durationMs: number | null;
			toolCalls: number;
			/** Newest first */
			events: AuditEventView[];
	  }
	| { kind: 'event'; id: string; event: AuditEventView };
