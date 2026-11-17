import type { AuditEventView, AuditOutcome, TimelineEntry } from './types.ts';

const EXECUTION_END = new Set(['execution.completed', 'execution.failed', 'execution.cancelled']);

/** The approval an event is about (`approval.requested`, `approval.decided`, `execution.paused`) */
export function approvalIdOf(event: AuditEventView): string | null {
	const id = event.metadata?.approvalId;
	return typeof id === 'string' && id ? id : null;
}

/** Approvals of these events that were answered (an `approval.decided` names them) */
export function decidedApprovalIds(events: AuditEventView[]): Set<string> {
	const ids = new Set<string>();
	for (const event of events) {
		const id = event.type === 'approval.decided' ? approvalIdOf(event) : null;
		if (id) ids.add(id);
	}
	return ids;
}

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

/** The client of an execution: the first event (newest first) that names one, with its info */
function clientOf(events: AuditEventView[]) {
	const named = events.find((event) => event.clientName) ?? null;
	const withInfo = events.find((event) => event.clientInfo) ?? null;
	return {
		clientName: named?.clientName ?? null,
		clientInfo: (named?.clientInfo || withInfo?.clientInfo) ?? null
	};
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
	const decided = decidedApprovalIds(sorted);
	const unanswered = sorted.some(
		(event) => event.type === 'approval.requested' && !decided.has(approvalIdOf(event) ?? '')
	);
	// Every approval answered and nothing since: the script continues only when the agent checks
	// back (a resume logs no event of its own; its tool calls do)
	const awaiting = !paused
		? null
		: unanswered
			? 'approval'
			: newest.type === 'approval.decided'
				? 'agent'
				: null;
	const withUser = sorted.find((event) => event.userId) ?? newest;
	return {
		kind: 'execution',
		id: `execution:${executionId}`,
		executionId,
		startedAt: oldest.occurredAt,
		lastAt: newest.occurredAt,
		outcome,
		awaiting,
		userId: withUser.userId ?? null,
		userName: withUser.userName,
		...clientOf(sorted),
		durationMs: end?.durationMs ?? null,
		toolCalls: sorted.filter((event) => event.type === 'tool.called').length,
		events: sorted
	};
}
