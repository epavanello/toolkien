import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRunnerClient } from './client.ts';
import { startLocalSupervisor, type LocalSupervisor } from './local.ts';
import type { RunnerClient, RunnerJob, ToolCallRequest, ToolCallResponse } from './types.ts';

const hasDeno = spawnSync('deno', ['--version']).status === 0;

const declarations = `
declare const crm: {
	findContacts(args: { query: string }): Promise<{ id: string }[]>;
	addNote(args: { contactId: string; text: string }): Promise<{ ok: boolean }>;
};`;

const job = (code: string, extra: Partial<RunnerJob> = {}): RunnerJob => ({
	executionId: 'exec-test',
	code,
	declarations,
	limits: { timeoutMs: 10_000, maxToolCalls: 20, maxOutputBytes: 10_000, memoryMb: 128 },
	...extra
});

describe.skipIf(!hasDeno)('runner (local supervisor)', () => {
	let supervisor: LocalSupervisor;
	let client: RunnerClient;

	beforeAll(async () => {
		supervisor = await startLocalSupervisor();
		client = createRunnerClient({ url: supervisor.url, secret: supervisor.secret });
	}, 60_000);
	afterAll(async () => {
		await supervisor?.stop();
	});

	it('reports health only with the right secret', async () => {
		expect(await client.health()).toBe(true);
		const wrong = createRunnerClient({ url: supervisor.url, secret: 'x'.repeat(64) });
		expect(await wrong.health()).toBe(false);
		const result = await wrong.run(job('return 1;'), async () => ({ kind: 'result', value: 1 }));
		expect(result).toMatchObject({ status: 'failed', code: 'runner_unavailable' });
	});

	it('runs a script with tool calls in seq order', async () => {
		const calls: ToolCallRequest[] = [];
		const result = await client.run(
			job(`const [c] = await crm.findContacts({ query: 'ada' });
				console.log('contact', c!.id);
				return await crm.addNote({ contactId: c!.id, text: 'hello' });`),
			async (call) => {
				calls.push(call);
				return call.path === 'crm.findContacts'
					? { kind: 'result', value: [{ id: 'c1' }] }
					: { kind: 'result', value: { ok: true } };
			}
		);
		expect(result).toEqual({
			status: 'completed',
			result: { ok: true },
			logs: 'contact c1',
			truncated: false
		});
		expect(calls).toEqual([
			{ seq: 1, path: 'crm.findContacts', args: { query: 'ada' } },
			{ seq: 2, path: 'crm.addNote', args: { contactId: 'c1', text: 'hello' } }
		]);
	});

	it('pauses at the call that needs approval and resumes with cached results', async () => {
		const code = `const a = await crm.findContacts({ query: 'a' });
			const note = await crm.addNote({ contactId: 'c1', text: 'x' });
			return { a, note };`;
		const seen: number[] = [];
		const paused = await client.run(job(code), async (call): Promise<ToolCallResponse> => {
			seen.push(call.seq);
			return call.seq === 2 ? { kind: 'pause' } : { kind: 'result', value: ['live'] };
		});
		expect(paused).toEqual({ status: 'paused', atSeq: 2, logs: '' });
		expect(seen).toEqual([1, 2]);

		const resumedCalls: number[] = [];
		const resumed = await client.run(
			job(code, { cachedResults: new Map([[1, { kind: 'result', value: ['cached'] }]]) }),
			async (call) => {
				resumedCalls.push(call.seq);
				return { kind: 'result', value: { ok: true } };
			}
		);
		expect(resumedCalls).toEqual([2]);
		expect(resumed).toMatchObject({
			status: 'completed',
			result: { a: ['cached'], note: { ok: true } }
		});
	});

	it('returns type errors immediately', async () => {
		const result = await client.run(
			job(`return await crm.findContacts({ query: 1 });`),
			async () => {
				throw new Error('must not be called');
			}
		);
		expect(result).toMatchObject({ status: 'failed', code: 'type_error' });
		expect(result.status === 'failed' && result.message).toMatch(/^script\.ts:1:/);
	});

	it.each([
		['fetch', `return await (globalThis as any).fetch('https://example.com');`],
		['env', `return (globalThis as any).Deno.env.toObject();`],
		['file read', `return (globalThis as any).Deno.readTextFileSync('/etc/hosts');`],
		['eval', `return eval('1 + 1');`],
		['dynamic import', `return await import('data:text/javascript,export default 1');`],
		['remote import', `return 1; }\nimport x from 'https://example.com/x.js';\nfunction y() {`],
		['subprocess', `return new (globalThis as any).Deno.Command('id').outputSync();`]
	])('blocks %s', async (_name, code) => {
		const result = await client.run(job(code), async () => ({ kind: 'result', value: null }));
		expect(result.status).toBe('failed');
	});

	it('enforces the timeout and truncates output', async () => {
		const loop = await client.run(
			job('while (true) {}', {
				limits: { timeoutMs: 1000, maxToolCalls: 1, maxOutputBytes: 1000, memoryMb: 64 }
			}),
			async () => ({ kind: 'result', value: null })
		);
		expect(loop).toMatchObject({ status: 'failed', code: 'timeout' });

		const big = await client.run(
			job(`for (let i = 0; i < 1000; i++) console.log('x'.repeat(100)); return 'done';`, {
				limits: { timeoutMs: 5000, maxToolCalls: 1, maxOutputBytes: 1000, memoryMb: 64 }
			}),
			async () => ({ kind: 'result', value: null })
		);
		expect(big).toMatchObject({ status: 'completed', result: 'done', truncated: true });
		expect(big.status === 'completed' && big.logs).toContain('[logs truncated');
	});

	it('cancels through the abort signal', async () => {
		const controller = new AbortController();
		setTimeout(() => controller.abort(), 300);
		const result = await client.run(
			job('await new Promise(() => {}); return 1;'),
			async () => ({ kind: 'result', value: null }),
			controller.signal
		);
		expect(result).toMatchObject({ status: 'failed', code: 'cancelled' });
	});
});

describe('runner client without a supervisor', () => {
	it('reports runner_unavailable', async () => {
		const client = createRunnerClient({ url: 'http://127.0.0.1:9', secret: 's' });
		expect(await client.health()).toBe(false);
		const result = await client.run(job('return 1;'), async () => ({ kind: 'result', value: 1 }));
		expect(result).toMatchObject({ status: 'failed', code: 'runner_unavailable' });
	});
});
