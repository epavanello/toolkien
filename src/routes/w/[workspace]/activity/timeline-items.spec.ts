import { describe, expect, it } from 'vitest';
import type { AuditEventView, TimelineEntry } from '#lib/server/audit/types.ts';
import { toTimelineItems, viaClient } from './timeline-items.ts';

const at = new Date(Date.UTC(2026, 10, 14, 10, 0));

const event = (over: Partial<AuditEventView>): AuditEventView => ({
	id: crypto.randomUUID(),
	occurredAt: at,
	type: 'tool.called',
	outcome: 'success',
	userName: 'Ann',
	...over
});

describe('activity timeline items', () => {
	it('shows the MCP client on executions and standalone events, once', () => {
		const call = event({
			toolPath: 'github.createIssue',
			executionId: 'x',
			clientName: 'Claude Code',
			clientInfo: 'claude-code 2.1.3'
		});
		const entries: TimelineEntry[] = [
			{
				kind: 'execution',
				id: 'execution:x',
				executionId: 'x',
				startedAt: at,
				lastAt: at,
				outcome: 'success',
				userId: 'u1',
				userName: 'Ann',
				clientName: 'Claude Code',
				clientInfo: 'claude-code 2.1.3',
				durationMs: 840,
				toolCalls: 1,
				events: [call]
			},
			{
				kind: 'event',
				id: 'e2',
				event: event({ type: 'tools.searched', clientName: 'Cursor', clientInfo: null })
			},
			{ kind: 'event', id: 'e3', event: event({ type: 'permission.changed' }) }
		];
		const [execution, search, permission] = toTimelineItems(entries, false);
		expect(execution.meta).toContain('via Claude Code (claude-code 2.1.3)');
		expect(execution.children![0].meta).not.toContain('via Claude Code (claude-code 2.1.3)');
		expect(search.meta).toContain('via Cursor');
		expect(permission.meta?.filter(Boolean)).toEqual([]);
	});

	it('labels a client known only by its MCP client info', () => {
		expect(viaClient(null, 'codex-mcp-client 0.40.0')).toBe('via codex-mcp-client 0.40.0');
		expect(viaClient(null, null)).toBeNull();
	});
});
