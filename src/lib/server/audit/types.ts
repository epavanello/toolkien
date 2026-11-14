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
	clientName?: string | null;
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
