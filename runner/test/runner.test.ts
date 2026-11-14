import { assert, assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import { createHandler } from '../src/server.ts';
import type { RunnerResult, SupervisorToApp, ToolCallResponse } from '../src/protocol.ts';
import { DECLARATIONS, LIMITS, type MockTool, run, SECRET, testConfig } from './helpers.ts';

Deno.test('happy path: tool calls, logs and result', async () => {
	const calls: { seq: number; path: string; args: unknown }[] = [];
	const r = await run(
		`const found = await crm.findContacts({ query: 'ada' });
		console.log('found', found.length);
		console.warn({ nested: { ok: true } });
		const note = await crm.addNote({ contactId: found[0]!.id, text: 'hi' });
		return { found, note };`,
		{ calls }
	);
	assertEquals(r, {
		status: 'completed',
		result: { found: [{ id: 'c1', name: 'match:ada' }], note: { ok: true } },
		logs: 'found 1\n[warn] { nested: { ok: true } }',
		truncated: false
	});
	assertEquals(
		calls.map((c) => [c.seq, c.path]),
		[
			[1, 'crm.findContacts'],
			[2, 'crm.addNote']
		]
	);
	assertEquals(calls[0]!.args, { query: 'ada' });
});

Deno.test('type errors return diagnostics mapped to the script lines', async () => {
	const r = await run(`const a = 1;\nawait crm.findContacts({ query: 42 });\nreturn a;`);
	assertEquals(r.status, 'failed');
	if (r.status !== 'failed') return;
	assertEquals(r.code, 'type_error');
	assertMatch(r.message, /^script\.ts:2:\d+ - error TS2322/);
});

Deno.test('tool errors are thrown as ToolCallError with a code', async () => {
	const r = await run(
		`try { await crm.addNote({ contactId: 'x', text: 'y' }); return 'no'; }
		catch (e) { return { name: (e as Error).name, code: (e as ToolCallError).code, path: (e as ToolCallError).path, message: (e as Error).message, isToolError: e instanceof ToolCallError }; }`,
		{
			tools: {
				'crm.addNote': () => ({
					kind: 'error',
					code: 'policy_denied',
					message: 'Blocked by policy.'
				})
			}
		}
	);
	assertEquals(r.status, 'completed');
	if (r.status === 'completed') {
		assertEquals(r.result, {
			name: 'ToolCallError',
			code: 'policy_denied',
			path: 'crm.addNote',
			message: 'crm.addNote failed [policy_denied]: Blocked by policy.',
			isToolError: true
		});
	}
});

Deno.test('pause stops the run at the seq that needs approval', async () => {
	const calls: { seq: number; path: string; args: unknown }[] = [];
	const r = await run(
		`console.log('before');
		await crm.findContacts({ query: 'a' });
		await crm.addNote({ contactId: 'c1', text: 'x' });
		await crm.findContacts({ query: 'never' });
		return 'unreachable';`,
		{
			calls,
			tools: {
				'crm.findContacts': () => ({ kind: 'result', value: [] }),
				'crm.addNote': () => ({ kind: 'pause' })
			}
		}
	);
	assertEquals(r, { status: 'paused', atSeq: 2, logs: 'before' });
	assertEquals(calls.length, 2);
});

Deno.test('seq replay: a re-run gets the same seqs and cached results are used', async () => {
	const code = `const out: unknown[] = [];
		const [a, b] = await Promise.all([crm.findContacts({ query: 'a' }), crm.findContacts({ query: 'b' })]);
		out.push(a, b);
		out.push(await crm.addNote({ contactId: 'c1', text: 'note' }));
		return out;`;
	const first: { seq: number; path: string; args: unknown }[] = [];
	const paused = await run(code, {
		calls: first,
		tools: {
			'crm.findContacts': (args) => ({
				kind: 'result',
				value: [(args as { query: string }).query]
			}),
			'crm.addNote': () => ({ kind: 'pause' })
		}
	});
	assertEquals(paused.status, 'paused');
	// Resume: seqs 1-2 come from the cache, seq 3 (approved) runs for real
	const cache = new Map<number, ToolCallResponse>([
		[1, { kind: 'result', value: ['cached-a'] }],
		[2, { kind: 'result', value: ['cached-b'] }]
	]);
	const replayed: number[] = [];
	const fromCache: MockTool = (args, seq) => {
		const hit = cache.get(seq);
		if (hit) {
			replayed.push(seq);
			return hit;
		}
		return { kind: 'result', value: { ok: true, args } };
	};
	const second: { seq: number; path: string; args: unknown }[] = [];
	const resumed = await run(code, {
		calls: second,
		tools: { 'crm.findContacts': fromCache, 'crm.addNote': fromCache }
	});
	assertEquals(
		second.map((c) => [c.seq, c.path]),
		first.map((c) => [c.seq, c.path])
	);
	assertEquals(replayed, [1, 2]);
	assertEquals(resumed.status, 'completed');
	if (resumed.status === 'completed') {
		assertEquals(resumed.result, [
			['cached-a'],
			['cached-b'],
			{ ok: true, args: { contactId: 'c1', text: 'note' } }
		]);
	}
});

Deno.test('logs are truncated with an explicit notice', async () => {
	const r = await run(
		`for (let i = 0; i < 5000; i++) console.log('line ' + i + ' ' + 'x'.repeat(50)); return 'ok';`,
		{
			limits: { maxOutputBytes: 2000 }
		}
	);
	assertEquals(r.status, 'completed');
	if (r.status !== 'completed') return;
	assertEquals(r.truncated, true);
	assertEquals(r.result, 'ok');
	assertStringIncludes(r.logs, '[logs truncated: output limit is 2000 bytes]');
	assert(new TextEncoder().encode(r.logs).length < 2200);
});

Deno.test('a large result is truncated with an explicit notice', async () => {
	const r = await run(`return 'y'.repeat(10_000);`, { limits: { maxOutputBytes: 1000 } });
	assertEquals(r.status, 'completed');
	if (r.status !== 'completed') return;
	assertEquals(r.truncated, true);
	assertMatch(String(r.result), /\[result truncated: 10002 bytes, output limit is 1000 bytes\]$/);
});

Deno.test('tool call limit', async () => {
	const r = await run(
		`for (let i = 0; i < 10; i++) await crm.findContacts({ query: String(i) }); return 1;`,
		{
			limits: { maxToolCalls: 3 }
		}
	);
	assertEquals(r.status, 'failed');
	if (r.status === 'failed') assertEquals(r.code, 'limit_tool_calls');
});

Deno.test('timeout on a script that never settles', async () => {
	const r = await run(`await new Promise(() => {}); return 1;`, { limits: { timeoutMs: 800 } });
	assertEquals(r.status, 'failed');
	if (r.status === 'failed') assertEquals(r.code, 'timeout');
});

Deno.test('non-serialisable result and unhandled rejections are runtime errors', async () => {
	const a = await run(`return { n: 10n } as unknown;`);
	assertEquals(a.status === 'failed' && a.code, 'runtime_error');
	const b = await run(
		`Promise.reject(new Error('late')); await new Promise((r) => setTimeout(r, 50)); return 1;`
	);
	assertEquals(b.status === 'failed' && b.code, 'runtime_error');
});

// ─── HTTP / WebSocket front ────────────────────────────────────────────────

async function withServer(fn: (base: string) => Promise<void>, maxConcurrent?: number) {
	const config = { ...(await testConfig()) };
	if (maxConcurrent) config.maxConcurrent = maxConcurrent;
	const controller = new AbortController();
	const server = Deno.serve(
		{ hostname: '127.0.0.1', port: 0, signal: controller.signal, onListen: () => {} },
		createHandler(config)
	);
	try {
		await fn(`127.0.0.1:${server.addr.port}`);
	} finally {
		controller.abort();
		await server.finished;
	}
}

function wsRun(
	base: string,
	secret: string,
	job: unknown,
	answer: (frame: Extract<SupervisorToApp, { type: 'tool_call' }>) => unknown
): Promise<RunnerResult | 'closed'> {
	return new Promise((resolve) => {
		const ws = new WebSocket(`ws://${base}/run`, {
			headers: { authorization: `Bearer ${secret}` }
		});
		ws.onopen = () => ws.send(JSON.stringify({ type: 'job', job }));
		ws.onmessage = (e) => {
			const frame = JSON.parse(e.data) as SupervisorToApp;
			if (frame.type === 'result') resolve(frame.result);
			else ws.send(JSON.stringify(answer(frame)));
		};
		ws.onerror = () => resolve('closed');
		ws.onclose = () => resolve('closed');
	});
}

Deno.test('server: authentication on health and run', async () => {
	await withServer(async (base) => {
		const noAuth = await fetch(`http://${base}/health`);
		assertEquals(noAuth.status, 401);
		await noAuth.body?.cancel();
		const wrong = await fetch(`http://${base}/health`, {
			headers: { authorization: 'Bearer nope' }
		});
		assertEquals(wrong.status, 401);
		await wrong.body?.cancel();
		const ok = await fetch(`http://${base}/health`, {
			headers: { authorization: `Bearer ${SECRET}` }
		});
		assertEquals((await ok.json()).ok, true);
		const ws = await wsRun(base, 'wrong', {}, () => ({}));
		assertEquals(ws, 'closed');
	});
});

Deno.test('server: job over WebSocket with tool calls', async () => {
	await withServer(async (base) => {
		const result = await wsRun(
			base,
			SECRET,
			{
				executionId: 'e1',
				code: `const c = await crm.findContacts({ query: 'q' }); return c.length;`,
				declarations: DECLARATIONS,
				limits: LIMITS
			},
			(frame) => ({
				type: 'tool_result',
				seq: frame.seq,
				response: { kind: 'result', value: [1, 2, 3] }
			})
		);
		assertEquals(result, { status: 'completed', result: 3, logs: '', truncated: false });
	});
});

Deno.test('server: pause frame and invalid job', async () => {
	await withServer(async (base) => {
		const paused = await wsRun(
			base,
			SECRET,
			{
				executionId: 'e2',
				code: `await crm.addNote({ contactId: 'a', text: 'b' }); return 1;`,
				declarations: DECLARATIONS,
				limits: LIMITS
			},
			(frame) => ({ type: 'pause', seq: frame.seq })
		);
		assertEquals(paused, { status: 'paused', atSeq: 1, logs: '' });
		const invalid = await wsRun(base, SECRET, { executionId: 'e3' }, () => ({}));
		assert(
			invalid !== 'closed' && invalid.status === 'failed' && invalid.code === 'runner_unavailable'
		);
	});
});

Deno.test('server: max concurrent jobs', async () => {
	await withServer(async (base) => {
		const slow = {
			executionId: 'slow',
			code: `await new Promise((r) => setTimeout(r, 1500)); return 1;`,
			declarations: '',
			limits: LIMITS
		};
		const [a, b] = await Promise.all([
			wsRun(base, SECRET, slow, () => ({})),
			new Promise((r) => setTimeout(r, 300)).then(() =>
				wsRun(base, SECRET, { ...slow, executionId: 'b' }, () => ({}))
			)
		]);
		assert(a !== 'closed' && a.status === 'completed');
		assert(b !== 'closed' && b.status === 'failed' && b.message.includes('capacity'));
	}, 1);
});
