import { and, desc, eq, gte, inArray, lt, lte, or, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { auditEvent, user } from '#lib/server/db/schema/index.ts';
import { auditCsv } from './csv.ts';
import { groupByExecution } from './timeline.ts';
import type {
	AuditEvent,
	AuditEventView,
	AuditQuery,
	AuditService,
	TimelineEntry
} from './types.ts';

export type * from './types.ts';
export { TECHNICAL_LOG_RETENTION_DAYS } from './types.ts';
export { groupByExecution } from './timeline.ts';
export { auditCsv, csvCell, AUDIT_CSV_COLUMNS } from './csv.ts';

/** Hard cap of one CSV export (newest first) */
export const CSV_EXPORT_MAX_ROWS = 50_000;
const DEFAULT_PAGE = 50;
const MAX_PAGE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export const record: AuditService['record'] = async (event) => {
	try {
		await db.insert(auditEvent).values(event);
	} catch {
		console.error(`[audit] failed to record ${event.type}`);
	}
};

// ─── Cursor ──────────────────────────────────────────────────────────────

export const encodeCursor = (event: Pick<AuditEvent, 'occurredAt' | 'id'>) =>
	Buffer.from(`${event.occurredAt.getTime()}:${event.id}`).toString('base64url');

export function decodeCursor(cursor: string): { at: Date; id: string } | null {
	const [at, id] = Buffer.from(cursor, 'base64url').toString().split(':');
	const time = Number(at);
	return Number.isFinite(time) && id ? { at: new Date(time), id } : null;
}

function conditions(q: AuditQuery): SQL[] {
	const where: SQL[] = [eq(auditEvent.workspaceId, q.workspaceId)];
	if (q.userId) where.push(eq(auditEvent.userId, q.userId));
	if (q.connectorId) where.push(eq(auditEvent.connectorId, q.connectorId));
	if (q.executionId) where.push(eq(auditEvent.executionId, q.executionId));
	if (q.outcome) where.push(eq(auditEvent.outcome, q.outcome));
	if (q.types?.length) where.push(inArray(auditEvent.type, q.types));
	if (q.from) where.push(gte(auditEvent.occurredAt, q.from));
	if (q.to) where.push(lte(auditEvent.occurredAt, q.to));
	const cursor = q.cursor ? decodeCursor(q.cursor) : null;
	if (cursor) {
		where.push(
			or(
				lt(auditEvent.occurredAt, cursor.at),
				and(eq(auditEvent.occurredAt, cursor.at), lt(auditEvent.id, cursor.id))
			)!
		);
	}
	return where;
}

const viewColumns = { event: auditEvent, userName: user.name };

const toView = ({
	event,
	userName
}: {
	event: typeof auditEvent.$inferSelect;
	userName: string | null;
}): AuditEventView => ({
	...event,
	metadata: event.metadata ?? undefined,
	userName
});

/** Events of a workspace, newest first, with the acting user's name. Callers enforce scope. */
export async function queryViews(
	q: AuditQuery
): Promise<{ events: AuditEventView[]; nextCursor: string | null }> {
	const limit = Math.min(Math.max(q.limit ?? DEFAULT_PAGE, 1), MAX_PAGE);
	const rows = await db
		.select(viewColumns)
		.from(auditEvent)
		.leftJoin(user, eq(user.id, auditEvent.userId))
		.where(and(...conditions(q)))
		.orderBy(desc(auditEvent.occurredAt), desc(auditEvent.id))
		.limit(limit + 1);
	const events = rows.slice(0, limit).map(toView);
	return {
		events,
		nextCursor: rows.length > limit ? encodeCursor(events[events.length - 1]) : null
	};
}

export const query: AuditService['query'] = async (q) => {
	const { events, nextCursor } = await queryViews(q);
	return { events: events.map(({ userName: _userName, ...event }) => event), nextCursor };
};

/**
 * The activity timeline: the newest `limit` matching events, with every execution they touch
 * completed by its other events (same workspace and user scope), grouped by execution.
 */
export async function timeline(
	q: Omit<AuditQuery, 'cursor'>
): Promise<{ entries: TimelineEntry[]; hasMore: boolean }> {
	const { events, nextCursor } = await queryViews(q);
	const executionIds = [...new Set(events.flatMap((e) => (e.executionId ? [e.executionId] : [])))];
	let all = events;
	if (executionIds.length > 0) {
		const scope: SQL[] = [
			eq(auditEvent.workspaceId, q.workspaceId),
			inArray(auditEvent.executionId, executionIds)
		];
		if (q.userId) scope.push(eq(auditEvent.userId, q.userId));
		const siblings = (
			await db
				.select(viewColumns)
				.from(auditEvent)
				.leftJoin(user, eq(user.id, auditEvent.userId))
				.where(and(...scope))
				.limit(MAX_PAGE * 4)
		).map(toView);
		const seen = new Set(events.map((e) => e.id));
		all = [...events, ...siblings.filter((e) => !seen.has(e.id))].sort(
			(a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id)
		);
	}
	return { entries: groupByExecution(all), hasMore: nextCursor !== null };
}

/** CSV of the matching events (admins), newest first, capped at `CSV_EXPORT_MAX_ROWS` */
export async function exportCsv(q: Omit<AuditQuery, 'cursor' | 'limit'>): Promise<string> {
	const events: AuditEventView[] = [];
	let cursor: string | undefined;
	do {
		const page = await queryViews({ ...q, cursor, limit: MAX_PAGE });
		events.push(...page.events);
		cursor = page.nextCursor ?? undefined;
	} while (cursor && events.length < CSV_EXPORT_MAX_ROWS);
	return auditCsv(events.slice(0, CSV_EXPORT_MAX_ROWS));
}

/** Retention job: deletes events older than `days` (the trigger allows DELETE) */
export const purgeOlderThan = async (days: number, now = new Date()): Promise<number> => {
	const cutoff = new Date(now.getTime() - days * DAY_MS);
	const deleted = await db
		.delete(auditEvent)
		.where(lt(auditEvent.occurredAt, cutoff))
		.returning({ id: auditEvent.id });
	return deleted.length;
};

/**
 * Account deletion: the user's events stay in their workspaces' trails without the user id (the
 * only update the append-only trigger allows).
 */
export async function anonymizeUser(userId: string) {
	await db.update(auditEvent).set({ userId: null }).where(eq(auditEvent.userId, userId));
	await db
		.update(auditEvent)
		.set({ approverUserId: null })
		.where(eq(auditEvent.approverUserId, userId));
}

/** Account deletion: events of workspaces deleted with the account go too */
export async function deleteForWorkspaces(workspaceIds: string[]) {
	if (workspaceIds.length === 0) return;
	await db.delete(auditEvent).where(inArray(auditEvent.workspaceId, workspaceIds));
}

/** The user's own events across workspaces (data export) */
export async function listForUser(userId: string, limit = 10_000) {
	return db
		.select()
		.from(auditEvent)
		.where(eq(auditEvent.userId, userId))
		.orderBy(desc(auditEvent.occurredAt))
		.limit(limit);
}
