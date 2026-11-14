import { describe, expect, it } from 'vitest';
import { cutBytes, decisionFromChoice, truncateOutput } from './output.ts';

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
