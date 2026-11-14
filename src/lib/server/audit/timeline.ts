import type { AuditEventView, AuditOutcome, TimelineEntry } from './types.ts';

const EXECUTION_END = new Set(['execution.completed', 'execution.failed', 'execution.cancelled']);

/**
 * Pure: groups events (newest first) into timeline entries. Events of one execution become a
 * single entry placed at the position of its newest event; others stay standalone.
 */
export function groupByExecution(events: AuditEventView[]): TimelineEntry[] {
	const entries: TimelineEntry[] = [];
	const groups = new Map<string, AuditEventView[]>();
	for (const event of events) {
		if (!event.executionId) {
			entries.push({ kind: 'event', id: event.id, event });
			continue;
		}
		let group = groups.get(event.executionId);
		if (!group) {
			group = [];
			groups.set(event.executionId, group);
			// Placeholder keeps the position of the newest event of the execution
			entries.push({ kind: 'execution', id: `execution:${event.executionId}` } as TimelineEntry);
		}
		group.push(event);
	}
	return entries.map((entry) => {
		if (entry.kind !== 'execution') return entry;
		const executionId = entry.id.slice('execution:'.length);
		return executionEntry(executionId, groups.get(executionId)!);
	});
}

function executionEntry(executionId: string, events: AuditEventView[]): TimelineEntry {
	const sorted = [...events].sort(
		(a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id.localeCompare(a.id)
	);
	const newest = sorted[0];
	const oldest = sorted[sorted.length - 1];
	const end = sorted.find((event) => EXECUTION_END.has(event.type));
	const paused = !end && sorted.find((event) => event.type === 'execution.paused');
	const outcome: AuditOutcome = end?.outcome ?? (paused ? 'pending' : newest.outcome);
	const withUser = sorted.find((event) => event.userId) ?? newest;
	return {
		kind: 'execution',
		id: `execution:${executionId}`,
		executionId,
		startedAt: oldest.occurredAt,
		lastAt: newest.occurredAt,
		outcome,
		userId: withUser.userId ?? null,
		userName: withUser.userName,
		clientName: sorted.find((event) => event.clientName)?.clientName ?? null,
		durationMs: end?.durationMs ?? null,
		toolCalls: sorted.filter((event) => event.type === 'tool.called').length,
		events: sorted
	};
}
