import type { TimelineItem } from '#lib/components/app/index.ts';
// The pure helper, not the component library barrel (keeps this module light for its spec)
import { humanize } from '#lib/components/app/status.ts';
import { clientLabel } from '#lib/core/format.ts';
import { approvalIdOf, decidedApprovalIds } from '#lib/server/audit/timeline.ts';
import type { AuditEventView, TimelineEntry } from '#lib/server/audit/types.ts';

/** Builds the links of rows (resolved by the page) */
export type TimelineLinks = { approval: (approvalId: string) => string };

/** Events that stood for "waiting on the human" until the approval was answered */
const WAITING_TYPES = new Set(['approval.requested', 'execution.paused']);

/** `via Claude Code (claude-code 2.1.3)`: the MCP client a request came through, if known */
export function viaClient(name: string | null | undefined, info: string | null | undefined) {
	const label = clientLabel(name, info);
	return label ? `via ${label}` : null;
}

/** Audit entries → generic timeline rows (titles, meta and status per event kind) */
export function toTimelineItems(
	entries: TimelineEntry[],
	showUser: boolean,
	links?: TimelineLinks
): TimelineItem[] {
	return entries.map((entry) => {
		if (entry.kind !== 'execution') return eventItem(entry.event, showUser, true, links);
		// The audit log is append-only: a request stays `pending` in its row once answered
		const decided = decidedApprovalIds(entry.events);
		return {
			id: entry.id,
			time: entry.lastAt,
			title: `Execution · ${entry.toolCalls} tool call${entry.toolCalls === 1 ? '' : 's'}`,
			status: entry.awaiting ? `awaiting_${entry.awaiting}` : entry.outcome,
			durationMs: entry.durationMs,
			meta: [
				// First: the rest is cut on narrow screens
				entry.awaiting === 'agent' ? 'continues when your agent checks back' : null,
				showUser ? entry.userName : null,
				viaClient(entry.clientName, entry.clientInfo)
			],
			// The client is on the execution row: its events do not repeat it
			children: entry.events.map((event) => {
				const item = eventItem(event, false, false, links);
				const answered = WAITING_TYPES.has(event.type) && decided.has(approvalIdOf(event) ?? '');
				return answered ? { ...item, status: undefined } : item;
			})
		};
	});
}

function eventItem(
	event: AuditEventView,
	showUser: boolean,
	showClient: boolean,
	links?: TimelineLinks
): TimelineItem {
	const approved = event.approvedBy
		? `approved by ${event.approvedBy === 'self' ? 'user' : event.approvedBy}`
		: null;
	const approvalId = approvalIdOf(event);
	return {
		id: event.id,
		time: event.occurredAt,
		title: event.toolPath ?? humanize(event.type),
		mono: !!event.toolPath,
		status: event.outcome,
		durationMs: event.durationMs,
		href: approvalId && links ? links.approval(approvalId) : undefined,
		meta: [
			event.toolPath ? humanize(event.type) : null,
			showUser ? event.userName : null,
			showClient ? viaClient(event.clientName, event.clientInfo) : null,
			approved
		]
	};
}
