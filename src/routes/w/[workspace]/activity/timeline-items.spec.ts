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
				awaiting: null,
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

	it('settles answered approvals and links them to their approval page', () => {
		const ids = { approvalId: 'a1' };
		const entries: TimelineEntry[] = [
			{
				kind: 'execution',
				id: 'execution:p',
				executionId: 'p',
				startedAt: at,
				lastAt: at,
				outcome: 'pending',
				awaiting: 'agent',
				userId: 'u1',
				userName: 'Ann',
				clientName: null,
				clientInfo: null,
				durationMs: null,
				toolCalls: 0,
				events: [
					event({ type: 'approval.decided', metadata: ids }),
					event({ type: 'execution.paused', outcome: 'pending', metadata: ids }),
					event({ type: 'approval.requested', outcome: 'pending', metadata: ids }),
					event({ type: 'execution.started' })
				]
			}
		];
		const [execution] = toTimelineItems(entries, false, { approval: (id) => `/approve/${id}` });
		expect(execution.status).toBe('awaiting_agent');
		expect(execution.meta?.[0]).toBe('continues when your agent checks back');
		expect(execution.children!.map((child) => [child.status, child.href])).toEqual([
			['success', '/approve/a1'],
			[undefined, '/approve/a1'],
			[undefined, '/approve/a1'],
			['success', undefined]
		]);
	});

	it('labels a client known only by its MCP client info', () => {
		expect(viaClient(null, 'codex-mcp-client 0.40.0')).toBe('via codex-mcp-client 0.40.0');
		expect(viaClient(null, null)).toBeNull();
	});
});
