/**
 * What the agent reads when something goes wrong: every message names where (script line,
 * column, code excerpt), what (expected vs actual, the tool and the error code) and what to do.
 */
import { assert, assertEquals, assertMatch, assertStringIncludes } from '@std/assert';
import { DECLARATIONS, defaultTools, run, TEXT_DECLARATIONS } from './helpers.ts';

Deno.test('uncaught tool errors name the tool, the script line and what to do', async () => {
	const r = await run(
		[
			"const found = await crm.findContacts({ query: 'a' });",
			"await crm.addNote({ contactId: found[0]!.id, text: 'x' });",
			'return 1;'
		].join('\n'),
		{
			tools: {
				...defaultTools,
				'crm.addNote': () => ({
					kind: 'error',
					code: 'blocked',
					message: '`crm.addNote` is blocked by the permissions of this workspace.'
				})
			}
		}
	);
	assertEquals(r.status, 'failed');
	if (r.status !== 'failed') return;
	assertEquals(r.code, 'runtime_error');
	const lines = r.message.split('\n');
	assertEquals(
		lines[0],
		'ToolCallError: crm.addNote failed [blocked]: `crm.addNote` is blocked by the permissions of this workspace.'
	);
	assertMatch(lines[1]!, /^ {2}at script\.ts:2:\d+$/);
	assertEquals(lines[2], "  await crm.addNote({ contactId: found[0]!.id, text: 'x' });");
	assertStringIncludes(
		r.message,
		'hint: This tool is blocked by the workspace permissions. Do not retry'
	);
});

Deno.test('upstream isError text reaches the agent with the tool and a hint', async () => {
	const r = await run(`return await crm.findContacts({ query: 'a' });`, {
		tools: {
			'crm.findContacts': () => ({
				kind: 'error',
				code: 'upstream_error',
				message: 'Rate limit exceeded: 10 requests per minute.'
			})
		}
	});
	assertEquals(r.status, 'failed');
	if (r.status !== 'failed') return;
	assertStringIncludes(
		r.message,
		'ToolCallError: crm.findContacts failed [upstream_error]: Rate limit exceeded: 10 requests per minute.'
	);
	assertStringIncludes(r.message, 'hint: The tool itself reported this error');
});

Deno.test('runtime errors point at the script line, through erased types and helpers', async () => {
	const r = await run(
		[
			'type Row = {',
			'\tid: string;',
			'};',
			'function pick(rows: Row[]) {',
			'\treturn (rows as any)[5].id;',
			'}',
			"return pick([{ id: 'a' }]);"
		].join('\n')
	);
	assertEquals(r.status, 'failed');
	if (r.status !== 'failed') return;
	assertMatch(
		r.message,
		/^TypeError: Cannot read properties of undefined \(reading 'id'\)\n {2}at script\.ts:5:\d+\n/
	);
	assertStringIncludes(r.message, '\treturn (rows as any)[5].id;');
	assertMatch(r.message, /\n {2}at script\.ts:7:\d+/);
	assert(!r.message.includes('prelude'), r.message);
	assert(!r.message.includes('file://'), r.message);
});

Deno.test(
	'type errors carry hints: unknown namespace, unknown tool, unknown result, bad args',
	async () => {
		const r = await run(
			[
				'const a = await crn.findContacts({ query: "x" });',
				'const b = await crm.findContact({ query: "x" });',
				'const c = await crm.addNote({ contactId: 1, text: "x" });',
				'const d = await other.lookup({});',
				'return d.items;'
			].join('\n'),
			{
				declarations: `${DECLARATIONS}\ndeclare const other: { lookup(args?: {}): Promise<unknown> };`
			}
		);
		assertEquals(r.status, 'failed');
		if (r.status !== 'failed') return;
		assertEquals(r.code, 'type_error');
		assertMatch(r.message, /script\.ts:1:17 - error TS\d+: Cannot find name 'crn'/);
		assertStringIncludes(
			r.message,
			'hint: Did you mean `crm`? Tool namespaces in this workspace: crm, other.'
		);
		assertStringIncludes(
			r.message,
			'hint: `crm` has no tool `findContact`. Did you mean `crm.findContacts`?'
		);
		assertStringIncludes(r.message, 'hint: In the arguments of `crm.addNote`');
		assertMatch(r.message, /script\.ts:5:8 - error TS18046/);
		assertStringIncludes(r.message, 'hint: This value is typed `unknown`');
	}
);

Deno.test('reading fields off a text result gets the no-output-schema hint', async () => {
	const r = await run('const d = await resend.listDomains({});\nreturn d.status;', {
		declarations: TEXT_DECLARATIONS
	});
	assertEquals(r.status, 'failed');
	if (r.status !== 'failed') return;
	assertMatch(
		r.message,
		/script\.ts:2:10 - error TS2339: Property 'status' does not exist on type 'ToolTextResult'/
	);
	assertStringIncludes(
		r.message,
		'hint: This tool has no output schema: its result is `ToolTextResult`'
	);
});

Deno.test('long lines show a window around the error column', async () => {
	const r = await run(`const s = '${'x'.repeat(400)}'; return s + undefinedName;`);
	assertEquals(r.status, 'failed');
	if (r.status !== 'failed') return;
	const excerptLine = r.message.split('\n')[1]!;
	assert(excerptLine.startsWith('  …'), excerptLine);
	assertStringIncludes(excerptLine, 'undefinedName');
	assert(excerptLine.length < 220);
});

Deno.test('non-serialisable results say why', async () => {
	const r = await run(`const cyclic: any = {}; cyclic.self = cyclic; return cyclic;`);
	assertEquals(r.status, 'failed');
	if (r.status !== 'failed') return;
	assertMatch(r.message, /^TypeError: The script result must be JSON-serialisable \(.+\)/);
});

Deno.test('shared and recursive $defs aliases (declare namespace) type-check and run', async () => {
	const r = await run(
		`const t = await shop.tree({ root: { name: 'a', children: [{ name: 'b' }] } }); return t;`,
		{
			declarations: `declare const shop: { tree(args: { root: shop.Node }): Promise<shop.Node> };
declare namespace shop {
	type Node = { name: string; children?: shop.Node[] };
}`,
			tools: {
				'shop.tree': (args) => ({ kind: 'result', value: (args as { root: unknown }).root })
			}
		}
	);
	assertEquals(r, {
		status: 'completed',
		result: { name: 'a', children: [{ name: 'b' }] },
		logs: '',
		truncated: false
	});
});

Deno.test('a catch variable gets its own hint, not the tool-result one', async () => {
	const r = await run(
		`try { await crm.findContacts({ query: 'a' }); } catch (e) { return e.message; }\nreturn 1;`
	);
	assertEquals(r.status, 'failed');
	if (r.status !== 'failed') return;
	assertStringIncludes(
		r.message,
		'hint: `catch (e)` gives `unknown`: use `(e as ToolCallError).code`'
	);
	assert(!r.message.includes('output schema'), r.message);
});

Deno.test('escape hatches from the type check run, with a warning per line', async () => {
	const r = await run(
		[
			"const found = await (crm as any).findContacts({ query: 'a' });",
			'// @ts-ignore',
			"const n: number = 'not checked';",
			"const note = '// @ts-ignore and as any inside a string are fine';",
			'return { id: (found as unknown as { id: string }[])[0]!.id, n, note };'
		].join('\n')
	);
	assertEquals(r.status, 'completed');
	assertEquals(
		r.warnings,
		[
			'Warning: line 1 casts to `any`: type checks were skipped there.',
			'Warning: line 2 uses `@ts-ignore`: type checks were skipped there.',
			'Warning: line 5 casts through `unknown`: type checks were skipped there.',
			'The script ran anyway. Remove these and fix the type errors they hide: those errors are how a wrong workspace, a missing tool or stale declarations show up.'
		].join('\n')
	);
});

Deno.test(
	'warnings also reach a script that fails at run time; clean scripts get none',
	async () => {
		const failed = await run(`return await (crm as any).nope({});`);
		assertEquals(failed.status, 'failed');
		assertStringIncludes(failed.warnings ?? '', 'Warning: line 1 casts to `any`');
		const clean = await run(`return (await crm.findContacts({ query: 'a' })).length;`);
		assertEquals(clean, { status: 'completed', result: 1, logs: '', truncated: false });
	}
);
