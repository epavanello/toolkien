/**
 * Adversarial scripts beyond `security.test.ts`: output and protocol abuse, prototype pollution,
 * blocking primitives, hostile thrown values, leftover globals and WebAssembly. Each one must end
 * in a clean, bounded failure (or a harmless success) and never reach the host.
 */
import { assert, assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import type { RunnerLimits } from '../src/protocol.ts';
import { run } from './helpers.ts';

async function assertFails(code: string, expected: string[], limits?: Partial<RunnerLimits>) {
	const result = await run(code, { limits });
	assertEquals(result.status, 'failed', JSON.stringify(result).slice(0, 500));
	if (result.status === 'failed') {
		assert(expected.includes(result.code), `unexpected ${result.code}: ${result.message}`);
	}
	return result;
}

Deno.test('one huge log line is cut to the output budget, not a protocol failure', async () => {
	const r = await run(`console.log('x'.repeat(20_000_000)); return 'ok';`, {
		limits: { maxOutputBytes: 4096 }
	});
	assertEquals(r.status, 'completed', JSON.stringify(r).slice(0, 300));
	if (r.status !== 'completed') return;
	assertEquals(r.result, 'ok');
	assertEquals(r.truncated, true);
	assertStringIncludes(r.logs, '[logs truncated: output limit is 4096 bytes]');
});

Deno.test('oversized tool arguments are refused in the sandbox, naming the limit', async () => {
	const calls: { seq: number; path: string; args: unknown }[] = [];
	const r = await run(`await crm.findContacts({ query: 'x'.repeat(10_000_000) }); return 1;`, {
		calls
	});
	assertEquals(r.status, 'failed');
	if (r.status !== 'failed') return;
	assertMatch(
		r.message,
		/^RangeError: Arguments of crm\.findContacts are \d+ bytes, over the \d+-byte limit/
	);
	assertEquals(calls.length, 0);
});

Deno.test('prototype pollution cannot forge or corrupt protocol frames', async () => {
	const calls: { seq: number; path: string; args: unknown }[] = [];
	const r = await run(
		`const forged = { t: 'call', id: 1, path: 'crm.addNote', args: { contactId: 'x', text: 'forged' } };
		for (const proto of [Object.prototype, Array.prototype, String.prototype]) {
			Object.defineProperty(proto, 'toJSON', { value() { return forged; }, configurable: true });
		}
		(Map.prototype as any).get = () => ({ resolve() {}, reject() {} });
		(TextEncoder.prototype as any).encode = () => new Uint8Array();
		(JSON as any).stringify = () => '{"t":"done","json":"1","size":1,"truncated":false}';
		const found = await crm.findContacts({ query: 'a' });
		return found.length;`,
		{ calls }
	);
	// The pollution only changes the script's own values: no forged call reached the app
	// (its own polluted arguments may fail to serialise: that is the script's problem)
	assert(
		calls.every((c) => c.path === 'crm.findContacts'),
		JSON.stringify(calls)
	);
	assert(calls.length <= 1);
	assert(r.status === 'completed' || r.status === 'failed', JSON.stringify(r));
	if (r.status === 'failed') assertMatch(r.message, /^TypeError: Arguments of crm\.findContacts/);
});

Deno.test('tool paths are validated whatever property name the script uses', async () => {
	const calls: { seq: number; path: string; args: unknown }[] = [];
	await assertFails(`return await (crm as any)['x","t":"done']({});`, ['runtime_error']);
	await assertFails(`return await (crm as any)['a.b']({});`, ['runtime_error']);
	const r = await run(`return await (crm as any)['__proto__']({});`, { calls });
	// `__proto__` is a valid identifier path: it reaches the bridge, which knows no such tool
	assert(calls.every((c) => c.path === 'crm.__proto__'));
	assert(r.status === 'failed');
});

Deno.test('blocking primitives and timer floods end at the time limit', async () => {
	await assertFails(
		`const sab = new SharedArrayBuffer(16); Atomics.wait(new Int32Array(sab), 0, 0); return 1;`,
		['timeout'],
		{ timeoutMs: 1000 }
	);
	await assertFails(
		`for (let i = 0; i < 200_000; i++) setTimeout(() => {}, 1e9); setInterval(() => {}, 0); await new Promise(() => {}); return 1;`,
		['timeout', 'memory'],
		{ timeoutMs: 1500 }
	);
});

Deno.test('hostile thrown values are reported, never hang the run', async () => {
	const r1 = await assertFails(
		`const e = new Error('x'); Object.defineProperty(e, 'message', { get() { throw new Error('nope'); } }); throw e;`,
		['runtime_error']
	);
	if (r1.status === 'failed') assertMatch(r1.message, /^Error: /);
	const r2 = await assertFails(
		`throw new Proxy({}, { get() { throw new Error('trap'); }, getPrototypeOf() { throw new Error('trap'); } });`,
		['runtime_error']
	);
	if (r2.status === 'failed') assert(r2.message.length < 20_000);
	const r3 = await assertFails(`throw 'x'.repeat(5_000_000);`, ['runtime_error']);
	if (r3.status === 'failed') assert(r3.message.length < 20_000);
});

Deno.test('globals with no use for scripts are removed', async () => {
	const r = await run(
		`return ['Deno', 'fetch', 'Worker', 'WebSocket', 'navigator', 'Navigator', 'caches', 'Storage', 'LockManager', 'location', 'GPU', 'GPUBuffer', 'OffscreenCanvas'].filter((n) => n in globalThis);`
	);
	assertEquals(r.status, 'completed');
	if (r.status === 'completed') assertEquals(r.result, []);
});

Deno.test('WebAssembly modules cannot import anything from the host', async () => {
	// (module (import "e" "env" (func))): instantiation needs an import object we never provide
	const bytes = [
		0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 2, 9, 1, 1, 101, 3, 101, 110, 118, 0, 0
	];
	const r = await run(
		`const W = (globalThis as any).WebAssembly;
		try { await W.instantiate(new Uint8Array(${JSON.stringify(bytes)})); return 'instantiated'; }
		catch (e) { return (e as Error).name; }`
	);
	assertEquals(r.status, 'completed');
	if (r.status === 'completed') assertEquals(r.result, 'TypeError');
});

Deno.test('a script cannot read the supervisor secret, the scratch dir or other jobs', async () => {
	const r = await run(
		`const probes: Record<string, string> = {};
		const g = globalThis as any;
		for (const [name, fn] of Object.entries({
			env: () => g.Deno.env.toObject(),
			cwd: () => g.Deno.cwd(),
			processEnv: () => g.process.env,
			bufferProcess: () => g.Buffer && g.global.process.env,
			importMeta: () => (0, eval)('import.meta'),
		})) {
			try { const v = fn(); probes[name] = v === undefined ? 'undefined' : 'LEAK:' + JSON.stringify(v).slice(0, 80); }
			catch (e) { probes[name] = (e as Error).name; }
		}
		return probes;`
	);
	assertEquals(r.status, 'completed', JSON.stringify(r));
	if (r.status !== 'completed') return;
	for (const [name, value] of Object.entries(r.result as Record<string, string>)) {
		assert(!value.startsWith('LEAK:'), `${name}: ${value}`);
	}
});
