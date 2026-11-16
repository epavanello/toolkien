import { humanize, type TimelineItem } from '#lib/components/app/index.ts';
import { clientLabel } from '#lib/core/format.ts';
import type { AuditEventView, TimelineEntry } from '#lib/server/audit/types.ts';

/** `via Claude Code (claude-code 2.1.3)`: the MCP client a request came through, if known */
export function viaClient(name: string | null | undefined, info: string | null | undefined) {
	const label = clientLabel(name, info);
	return label ? `via ${label}` : null;
}

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
					meta: [showUser ? entry.userName : null, viaClient(entry.clientName, entry.clientInfo)],
					// The client is on the execution row: its events do not repeat it
					children: entry.events.map((event) => eventItem(event, false, false))
				}
			: eventItem(entry.event, showUser, true)
	);
}

function eventItem(event: AuditEventView, showUser: boolean, showClient: boolean): TimelineItem {
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
			showClient ? viaClient(event.clientName, event.clientInfo) : null,
			approved
		]
	};
}
