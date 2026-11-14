import { humanize, type TimelineItem } from '#lib/components/app/index.ts';
import type { AuditEventView, TimelineEntry } from '#lib/server/audit/types.ts';

/** Audit entries → generic timeline rows (titles, meta and status per event kind) */
export function toTimelineItems(entries: TimelineEntry[], showUser: boolean): TimelineItem[] {
	return entries.map((entry) =>
		entry.kind === 'execution'
			? {
					id: entry.id,
					time: entry.lastAt,
					title: `Execution · ${entry.toolCalls} tool call${entry.toolCalls === 1 ? '' : 's'}`,
					status: entry.outcome,
					durationMs: entry.durationMs,
					meta: [showUser ? entry.userName : null, entry.clientName],
					children: entry.events.map((event) => eventItem(event, false))
				}
			: eventItem(entry.event, showUser)
	);
}

function eventItem(event: AuditEventView, showUser: boolean): TimelineItem {
	const approved = event.approvedBy
		? `approved by ${event.approvedBy === 'self' ? 'user' : event.approvedBy}`
		: null;
	return {
		id: event.id,
		time: event.occurredAt,
		title: event.toolPath ?? humanize(event.type),
		mono: !!event.toolPath,
		status: event.outcome,
		durationMs: event.durationMs,
		meta: [
			event.toolPath ? humanize(event.type) : null,
			showUser ? event.userName : null,
			event.clientName,
			approved
		]
	};
}
