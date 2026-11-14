/**
 * Escape attempts: every one must fail (type error at check time or runtime error / limit in the
 * sandbox), and none may return host data.
 */
import { assert, assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import { sandboxFlags } from '../src/job.ts';
import type { RunnerLimits } from '../src/protocol.ts';
import { run } from './helpers.ts';

const any = (expr: string) => `(globalThis as any)${expr}`;

async function assertFails(
	code: string,
	expected: 'type_error' | 'runtime_error' | 'timeout' | 'memory' | Array<string>,
	limits?: Partial<RunnerLimits>
) {
	const result = await run(code, { limits });
	assertEquals(result.status, 'failed', JSON.stringify(result));
	if (result.status !== 'failed') return result;
	const codes = Array.isArray(expected) ? expected : [expected];
	assert(codes.includes(result.code), `unexpected ${result.code}: ${result.message}`);
	return result;
}

Deno.test('fetch is a type error and unavailable at runtime', async () => {
	await assertFails(`return await fetch('https://example.com');`, 'type_error');
	await assertFails(`return await ${any(".fetch('https://example.com')")};`, 'runtime_error');
});

Deno.test('Deno namespace is a type error and removed at runtime', async () => {
	await assertFails(`return Deno.env.get('HOME');`, 'type_error');
	const r = await assertFails(`return ${any('.Deno.env.toObject()')};`, 'runtime_error');
	if (r.status === 'failed') assertMatch(r.message, /TypeError/);
});

Deno.test('env read through node process fails', async () => {
	await assertFails(
		`return ${any('.process.env.RUNNER_SHARED_SECRET')} ?? Object.keys(${any('.process.env')});`,
		'runtime_error'
	);
});

Deno.test('file read and write fail', async () => {
	await assertFails(`return ${any(".Deno.readTextFileSync('/etc/hosts')")};`, 'runtime_error');
	await assertFails(
		`${any(".Deno.writeTextFileSync('/tmp/pwned', 'x')")}; return 1;`,
		'runtime_error'
	);
});

Deno.test('subprocesses fail (Deno.run / Deno.Command)', async () => {
	await assertFails(`return new Deno.Command('id').outputSync();`, 'type_error');
	await assertFails(`return new (${any('.Deno.Command')})('id').outputSync();`, 'runtime_error');
	await assertFails(`return ${any(".Deno.run({ cmd: ['id'] })")};`, 'runtime_error');
});

Deno.test('infinite loop hits the timeout and is killed', async () => {
	const started = Date.now();
	await assertFails(`while (true) {}`, 'timeout', { timeoutMs: 1000 });
	assert(Date.now() - started < 8000);
});

Deno.test('memory blow-up hits the heap limit', async () => {
	await assertFails(
		`const a: string[] = []; while (true) a.push('x'.repeat(1024) + Math.random());`,
		['memory', 'timeout'],
		{ memoryMb: 48, timeoutMs: 20_000 }
	);
});

Deno.test('static and remote imports are rejected', async () => {
	await assertFails(`import x from 'https://deno.land/x/mod.ts'; return x;`, 'type_error');
	// Escaping the function wrapper to reach the top level
	await assertFails(
		`return 1; }\nimport x from '/etc/hosts' with { type: 'json' };\nexport function f() {`,
		'type_error'
	);
	await assertFails(
		`return 1; }\nexport * from 'https://example.com/x.js';\nfunction g() {`,
		'type_error'
	);
	// Unterminated comment swallowing the wrapper's closing brace
	await assertFails(`return 1; /*`, 'type_error');
});

Deno.test('dynamic import is rejected, also through eval and Function', async () => {
	await assertFails(`return await import('data:text/javascript,export default 1');`, 'type_error');
	await assertFails(`const s = 'https://example.com/x.js'; return await import(s);`, 'type_error');
	await assertFails(
		`return eval("import('data:text/javascript,export default 1')");`,
		'runtime_error'
	);
	await assertFails(`return new Function("return import('/etc/hosts')")();`, 'runtime_error');
	await assertFails(
		`const AsyncFn = Object.getPrototypeOf(async function () {}).constructor; return await AsyncFn("return 1")();`,
		'runtime_error'
	);
});

Deno.test('import.meta and import types are rejected', async () => {
	await assertFails(`return import.meta.url;`, 'type_error');
	await assertFails(`let x: import('/etc/hosts').T; return 1;`, 'type_error');
});

Deno.test('reference directives cannot read host files', async () => {
	const r = await run(`/// <reference path="/etc/hosts" />\nreturn 1;`, {
		declarations: `/// <reference path="/etc/hosts" />\nimport '/etc/passwd';\ndeclare const crm: { a(args: {}): Promise<number> };`
	});
	assertEquals(r.status, 'completed');
	assert(!JSON.stringify(r).includes('localhost'));
});

Deno.test('prototype tricks cannot reach the host', async () => {
	await assertFails(
		`return ({} as any).constructor.constructor('return Deno')();`,
		'runtime_error'
	);
	await assertFails(
		`return (crm as any).constructor.constructor('return this')();`,
		'runtime_error'
	);
	await assertFails(
		`return new (${any('.Worker')})('data:text/javascript,1', { type: 'module' });`,
		'runtime_error'
	);
	const r = await run(`
		const keys = Reflect.ownKeys(globalThis).map(String);
		const sym = (globalThis as any)[Symbol.for('Deno.internal')];
		let frames: unknown[] = [];
		(Error as any).prepareStackTrace = (_e: unknown, s: any[]) => s.map((f) => typeof f.getFunction?.());
		try { throw new Error('x'); } catch (e) { frames = (e as any).stack; }
		return { hasDeno: keys.includes('Deno'), sym: typeof sym, frames };
	`);
	assertEquals(r.status, 'completed');
	if (r.status !== 'completed') return;
	const value = r.result as { hasDeno: boolean; sym: string; frames: string[] };
	assertEquals(value.hasDeno, false);
	assertEquals(value.sym, 'undefined');
	assert(!value.frames.includes('function'), 'stack frames must not expose functions');
});

Deno.test('tool namespaces cannot be replaced or used to forge paths', async () => {
	const r = await run(`
		try { (globalThis as any).crm = { findContacts: () => 'fake' }; } catch {}
		const out = await crm.findContacts({ query: 'x' });
		return out;
	`);
	assertEquals(r.status, 'completed');
	if (r.status === 'completed') assertEquals((r.result as { id: string }[])[0]?.id, 'c1');
	await assertFails(`return await (crm as any)['bad/path']({});`, 'runtime_error');
});

Deno.test('permission layer alone denies net, env, read, write and run', async () => {
	// The raw sandbox flags, without the prelude: Deno itself must refuse everything
	const dir = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(
			`${dir}/raw.js`,
			`const results = {};
			const attempt = async (name, fn) => { try { await fn(); results[name] = 'ALLOWED'; } catch (e) { results[name] = e.name; } };
			await attempt('net', () => fetch('http://127.0.0.1:1'));
			await attempt('env', () => Deno.env.get('HOME'));
			await attempt('read', () => Deno.readTextFileSync('/etc/hosts'));
			await attempt('write', () => Deno.writeTextFileSync('/tmp/toolkien-pwned', 'x'));
			await attempt('run', () => new Deno.Command('id').outputSync());
			await attempt('sys', () => Deno.hostname());
			await attempt('remote', () => import('https://deno.land/std/version.ts'));
			await attempt('outside', () => import('/etc/hosts', { with: { type: 'json' } }));
			await attempt('eval', () => eval('1'));
			console.log(JSON.stringify(results));`
		);
		const out = await new Deno.Command(Deno.execPath(), {
			args: ['run', ...sandboxFlags(64), `${dir}/raw.js`],
			clearEnv: true,
			env: { NO_COLOR: '1', DENO_DIR: `${dir}/.deno` },
			cwd: dir,
			stdout: 'piped',
			stderr: 'piped'
		}).output();
		const results = JSON.parse(new TextDecoder().decode(out.stdout)) as Record<string, string>;
		for (const [name, value] of Object.entries(results)) {
			assert(value !== 'ALLOWED', `${name} must be denied`);
		}
		assertEquals(Object.keys(results).length, 9);
	} finally {
		await Deno.remove(dir, { recursive: true });
	}
});

Deno.test('errors from the sandbox do not leak the scratch path', async () => {
	const r = await assertFails(`throw new Error('boom');`, 'runtime_error');
	if (r.status === 'failed') {
		assertStringIncludes(r.message, 'Error: boom');
		assert(!r.message.includes('job-'));
	}
});
