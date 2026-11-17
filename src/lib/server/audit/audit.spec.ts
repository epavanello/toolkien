import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.ts', async () => {
	const { createTestDb } = await import('#lib/server/workspaces/test-db.ts');
	return { db: await createTestDb() };
});

import { db } from '#lib/server/db/index.ts';
import { auditEvent, mcpConnection, oauthClient } from '#lib/server/db/schema/index.ts';
import { seedUser } from '#lib/server/workspaces/test-db.ts';
import {
	anonymizeUser,
	auditCsv,
	csvCell,
	exportCsv,
	groupByExecution,
	purgeOlderThan,
	queryViews,
	record,
	timeline
} from './index.ts';
import type { AuditEventView } from './types.ts';

const DAY = 24 * 60 * 60 * 1000;

const view = (over: Partial<AuditEventView>): AuditEventView => ({
	id: crypto.randomUUID(),
	occurredAt: new Date(),
	type: 'auth.login',
	outcome: 'success',
	userName: null,
	...over
});

describe('timeline grouping', () => {
	it('groups events by execution at the position of their newest event', () => {
		const t = (s: number) => new Date(Date.UTC(2026, 10, 14, 10, 0, s));
		const events = [
			view({
				id: 'e5',
				occurredAt: t(5),
				type: 'execution.completed',
				executionId: 'x',
				outcome: 'success',
				durationMs: 900
			}),
			view({ id: 'e4', occurredAt: t(4), type: 'permission.changed' }),
			view({
				id: 'e3',
				occurredAt: t(3),
				type: 'tool.called',
				executionId: 'x',
				connectorId: 'c1'
			}),
			view({
				id: 'e2',
				occurredAt: t(2),
				type: 'tool.called',
				executionId: 'x',
				outcome: 'failure'
			}),
			view({
				id: 'e1',
				occurredAt: t(1),
				type: 'execution.started',
				executionId: 'x',
				userId: 'u',
				userName: 'Ann'
			})
		];
		const entries = groupByExecution(events);
		expect(entries.map((e) => e.id)).toEqual(['execution:x', 'e4']);
		const group = entries[0];
		if (group.kind !== 'execution') throw new Error('expected a group');
		expect(group).toMatchObject({
			toolCalls: 2,
			outcome: 'success',
			durationMs: 900,
			userName: 'Ann'
		});
		expect(group.startedAt).toEqual(t(1));
		expect(group.events.map((e) => e.id)).toEqual(['e5', 'e3', 'e2', 'e1']);
	});

	it('marks a paused execution as pending', () => {
		const [entry] = groupByExecution([
			view({ type: 'execution.paused', executionId: 'p', outcome: 'pending' }),
			view({ type: 'execution.started', executionId: 'p' })
		]);
		expect(entry.kind === 'execution' && entry.outcome).toBe('pending');
	});

	it('says whether a paused execution waits for the human or for the agent', () => {
		const t = (s: number) => new Date(Date.UTC(2026, 10, 14, 10, 0, s));
		const requested = [
			view({
				occurredAt: t(3),
				type: 'execution.paused',
				executionId: 'p',
				outcome: 'pending',
				metadata: { approvalId: 'a1' }
			}),
			view({
				occurredAt: t(2),
				type: 'approval.requested',
				executionId: 'p',
				outcome: 'pending',
				metadata: { approvalId: 'a1' }
			}),
			view({ occurredAt: t(1), type: 'execution.started', executionId: 'p' })
		];
		const decided = view({
			occurredAt: t(4),
			type: 'approval.decided',
			executionId: 'p',
			metadata: { approvalId: 'a1' }
		});
		const resumedCall = view({ occurredAt: t(5), type: 'tool.called', executionId: 'p' });
		const awaiting = (events: AuditEventView[]) => {
			const [entry] = groupByExecution(events);
			return entry.kind === 'execution' ? entry.awaiting : undefined;
		};
		expect(awaiting(requested)).toBe('approval');
		expect(awaiting([decided, ...requested])).toBe('agent');
		expect(awaiting([resumedCall, decided, ...requested])).toBeNull();
		expect(
			awaiting([
				view({ occurredAt: t(6), type: 'execution.completed', executionId: 'p' }),
				resumedCall,
				decided,
				...requested
			])
		).toBeNull();
	});
});

describe('csv export', () => {
	it('escapes quotes, commas, newlines and spreadsheet formulas', () => {
		expect(csvCell('plain')).toBe('plain');
		expect(csvCell('a,b')).toBe('"a,b"');
		expect(csvCell('say "hi"')).toBe('"say ""hi"""');
		expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
		expect(csvCell('-1+1')).toBe("'-1+1");
		expect(csvCell(null)).toBe('');
		expect(csvCell(new Date(0))).toBe('1970-01-01T00:00:00.000Z');
	});

	it('exports metadata columns only, one row per event', async () => {
		const workspaceId = crypto.randomUUID();
		await record({
			type: 'tool.called',
			outcome: 'success',
			workspaceId,
			clientId: 'dcr-client-1',
			clientName: 'Claude Code',
			clientInfo: 'claude-code 2.1.3',
			toolPath: 'github.createIssue',
			durationMs: 840,
			metadata: { seq: 1 }
		});
		await record({ type: 'auth.login', outcome: 'failure', workspaceId: crypto.randomUUID() });
		const csv = await exportCsv({ workspaceId });
		const lines = csv.trim().split('\r\n');
		expect(lines[0]).toBe(
			'occurred_at,type,outcome,user_id,user_name,client,client_info,connector_id,tool,execution_id,duration_ms,approved_by,approver_user_id,metadata'
		);
		expect(lines).toHaveLength(2);
		expect(lines[1]).toContain('tool.called,success');
		expect(lines[1]).toContain('github.createIssue');
		expect(lines[1]).toContain(',Claude Code,claude-code 2.1.3,');
		expect(lines[1]).toContain('"{""seq"":1}"');
		expect(auditCsv([])).toBe(`${lines[0]}\r\n`);
	});
});

describe('client of an event', () => {
	it('names the execution client from any of its events, with the MCP client info', () => {
		const t = (s: number) => new Date(Date.UTC(2026, 10, 14, 10, 0, s));
		const [entry] = groupByExecution([
			view({ id: 'b', occurredAt: t(2), type: 'tool.called', executionId: 'x', clientId: 'c' }),
			view({
				id: 'a',
				occurredAt: t(1),
				type: 'execution.started',
				executionId: 'x',
				clientId: 'c',
				clientName: 'Cursor',
				clientInfo: 'cursor-vscode 1.0.0'
			})
		]);
		expect(entry).toMatchObject({ clientName: 'Cursor', clientInfo: 'cursor-vscode 1.0.0' });
	});

	it("falls back to the client's registered name for events recorded without one", async () => {
		const workspaceId = crypto.randomUUID();
		const clientId = `client-${crypto.randomUUID()}`;
		await db.insert(oauthClient).values({
			id: crypto.randomUUID(),
			clientId,
			name: 'Codex',
			redirectUris: ['http://127.0.0.1:1455/callback']
		});
		await record({ type: 'tool.called', outcome: 'success', workspaceId, clientId });
		await record({
			type: 'tools.searched',
			outcome: 'success',
			workspaceId,
			clientId,
			clientName: 'Codex CLI',
			clientInfo: 'codex-mcp-client 0.40.0'
		});
		await record({ type: 'auth.login', outcome: 'success', workspaceId });
		const { events } = await queryViews({ workspaceId });
		const byType = new Map(events.map((event) => [event.type, event]));
		expect(byType.get('tool.called')).toMatchObject({ clientName: 'Codex', clientInfo: null });
		expect(byType.get('tools.searched')).toMatchObject({
			clientName: 'Codex CLI',
			clientInfo: 'codex-mcp-client 0.40.0'
		});
		expect(byType.get('auth.login')).toMatchObject({ clientName: null });
	});

	it("shows the connection's current label on its past events, except the rename itself", async () => {
		const workspaceId = crypto.randomUUID();
		const clientId = `client-${crypto.randomUUID()}`;
		const { id: userId } = await seedUser(db);
		const [laptop, phone] = [crypto.randomUUID(), crypto.randomUUID()];
		const used = { workspaceId, userId, clientId, clientName: 'Claude' };
		await record({ type: 'tools.searched', outcome: 'success', ...used, connectionId: laptop });
		await record({ type: 'tools.described', outcome: 'success', ...used, connectionId: phone });
		await record({
			...used,
			connectionId: laptop,
			type: 'mcp_client.renamed',
			outcome: 'success',
			clientName: 'Pack'
		});
		await db.insert(mcpConnection).values([
			{ id: laptop, userId, clientId, label: 'Work laptop' },
			{ id: phone, userId, clientId, label: null }
		]);
		const { events } = await queryViews({ workspaceId });
		expect(events).toHaveLength(3);
		const byType = new Map(events.map((event) => [event.type, event]));
		expect(byType.get('tools.searched')).toMatchObject({ clientName: 'Work laptop' });
		// Another connection of the same client keeps its own name
		expect(byType.get('tools.described')).toMatchObject({ clientName: 'Claude' });
		expect(byType.get('mcp_client.renamed')).toMatchObject({ clientName: 'Pack' });
	});
});

describe('queries, retention and anonymisation', () => {
	it('filters, paginates with a cursor and fills execution groups', async () => {
		const workspaceId = crypto.randomUUID();
		const ann = await seedUser(db, { name: 'Ann' });
		const base = Date.now() - 60_000;
		for (let i = 0; i < 5; i++) {
			await db.insert(auditEvent).values({
				type: 'tool.called',
				outcome: i === 0 ? 'failure' : 'success',
				workspaceId,
				userId: ann.id,
				executionId: 'exec-1',
				connectorId: i % 2 ? 'c1' : 'c2',
				occurredAt: new Date(base + i * 1000)
			});
		}
		const first = await queryViews({ workspaceId, limit: 2 });
		expect(first.events).toHaveLength(2);
		expect(first.events[0].userName).toBe('Ann');
		const second = await queryViews({ workspaceId, limit: 10, cursor: first.nextCursor! });
		expect(second.events).toHaveLength(3);
		expect(second.nextCursor).toBeNull();
		expect((await queryViews({ workspaceId, outcome: 'failure' })).events).toHaveLength(1);
		expect((await queryViews({ workspaceId, connectorId: 'c1' })).events).toHaveLength(2);
		expect((await queryViews({ workspaceId, userId: 'someone-else' })).events).toHaveLength(0);

		// One matching event brings its whole execution into the timeline
		const { entries } = await timeline({ workspaceId, outcome: 'failure' });
		expect(entries).toHaveLength(1);
		expect(entries[0].kind === 'execution' && entries[0].events).toHaveLength(5);
	});

	it('purges events older than the retention and anonymises deleted users', async () => {
		const workspaceId = crypto.randomUUID();
		const now = new Date();
		await db.insert(auditEvent).values([
			{
				type: 'auth.login',
				outcome: 'success',
				workspaceId,
				occurredAt: new Date(now.getTime() - 91 * DAY)
			},
			{
				type: 'auth.login',
				outcome: 'success',
				workspaceId,
				occurredAt: new Date(now.getTime() - 89 * DAY),
				userId: 'gone',
				approverUserId: 'gone'
			}
		]);
		expect(await purgeOlderThan(90, now)).toBeGreaterThanOrEqual(1);
		const left = (await queryViews({ workspaceId })).events;
		expect(left).toHaveLength(1);
		await anonymizeUser('gone');
		const [row] = (await queryViews({ workspaceId })).events;
		expect(row.userId).toBeNull();
		expect(row.approverUserId).toBeNull();
		// Any other update is refused by the append-only trigger
		await expect(db.update(auditEvent).set({ outcome: 'failure' })).rejects.toThrow();
	});
});

describe('activity scope', async () => {
	const { activityQuery } = await import('./scope.ts');
	const actor = { workspaceId: 'w', userId: 'me', role: 'member' as const };

	it('forces members to their own events and lets admins filter by user', () => {
		const now = new Date('2026-11-14T00:00:00Z');
		expect(activityQuery(actor, false, { userId: 'other', range: '24h' }, now)).toEqual({
			workspaceId: 'w',
			userId: 'me',
			connectorId: undefined,
			outcome: undefined,
			from: new Date('2026-11-13T00:00:00Z')
		});
		expect(activityQuery(actor, true, { userId: 'other', range: 'all' }, now)).toMatchObject({
			userId: 'other',
			from: undefined
		});
		expect(activityQuery(actor, true, {}, now).userId).toBeUndefined();
	});
});
