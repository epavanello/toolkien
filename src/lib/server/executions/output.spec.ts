import { describe, expect, it } from 'vitest';
import {
	cutBytes,
	decisionFromChoice,
	pendingApprovalRow,
	previewLine,
	truncateOutput
} from './output.ts';
import type { PendingApproval } from './types.ts';

describe('output', () => {
	it('cuts UTF-8 without splitting characters', () => {
		expect(cutBytes('aé', 2)).toBe('a');
		expect(cutBytes('abc', 10)).toBe('abc');
		expect(cutBytes('abc', 0)).toBe('');
	});

	it('leaves small output alone', () => {
		expect(truncateOutput({ result: { a: 1 }, logs: 'hi', truncated: false }, 100)).toEqual({
			result: { a: 1 },
			logs: 'hi',
			truncated: false
		});
	});

	it('keeps the result and cuts logs first, with a notice', () => {
		const out = truncateOutput({ result: 'ok', logs: 'x'.repeat(500), truncated: false }, 200);
		expect(out.result).toBe('ok');
		expect(out.truncated).toBe(true);
		expect(out.logs).toContain('Output truncated at 200 bytes');
		expect(Buffer.byteLength(JSON.stringify(out.result) + out.logs)).toBeLessThanOrEqual(200);
	});

	it('cuts an oversized result to its JSON text', () => {
		const out = truncateOutput({ result: 'y'.repeat(500), logs: '', truncated: false }, 200);
		expect(typeof out.result).toBe('string');
		expect(out.logs).toContain('Output truncated');
	});

	it('adds the notice when the runner already truncated', () => {
		const out = truncateOutput({ result: 1, logs: 'a', truncated: true }, 1000);
		expect(out).toMatchObject({ result: 1, truncated: true });
		expect(out.logs).toContain('Output truncated');
	});

	it('maps human choices to decisions', () => {
		expect(decisionFromChoice('approve_once')).toEqual({ decision: 'approve', scope: 'once' });
		expect(decisionFromChoice('approve_tool')).toEqual({
			decision: 'approve',
			scope: 'tool_in_script'
		});
		expect(decisionFromChoice('reject')).toEqual({ decision: 'reject' });
	});
});

describe('pending approval rows', () => {
	it('cuts the arguments preview to one short line', () => {
		expect(previewLine('{\n  "title":   "Bug"\n}')).toBe('{ "title": "Bug" }');
		expect(previewLine('   ')).toBe('(none)');
		const long = previewLine('x'.repeat(500));
		expect(long).toHaveLength(160);
		expect(long.endsWith('…')).toBe(true);
	});

	it('adds the connector logo by namespace and the client label', () => {
		const pending: PendingApproval = {
			approvalId: 'a1',
			executionId: 'e1',
			workspaceId: 'w1',
			workspaceName: 'Acme',
			connectorName: 'GitHub',
			toolPath: 'github.createIssue',
			argumentsPreview: '{\n  "title": "Bug"\n}',
			approvalUrl: 'https://toolkien.test/approve/a1',
			status: 'pending',
			createdAt: new Date('2026-11-14T11:30:00Z'),
			expiresAt: new Date('2026-11-14T12:00:00Z'),
			clientName: 'Claude Code',
			clientInfo: 'claude-code 2.1.3'
		};
		expect(pendingApprovalRow(pending, new Map([['github', '/connectors/icon/c1']]))).toEqual({
			approvalId: 'a1',
			executionId: 'e1',
			toolPath: 'github.createIssue',
			connectorName: 'GitHub',
			connectorIcon: '/connectors/icon/c1',
			argumentsPreview: '{ "title": "Bug" }',
			client: 'Claude Code (claude-code 2.1.3)',
			createdAt: pending.createdAt,
			expiresAt: pending.expiresAt
		});
		expect(
			pendingApprovalRow({ ...pending, clientName: null, clientInfo: null }, new Map())
		).toMatchObject({ connectorIcon: null, client: null });
	});
});
