/**
 * Fidelity harness: real `tools/list` answers (fixtures/*.json, fetched from public MCP servers
 * plus a hand-written file with every construct) rendered to `.d.ts`, then checked three ways:
 *
 * 1. The declarations compile under `strict` with no diagnostics.
 * 2. Coverage: every fact of every schema (property names, descriptions, enum/const values,
 *    defaults, examples, constraints, unknown keywords) appears in the text the agent reads.
 * 3. Round trip through the TypeScript checker: for each object reachable through properties,
 *    the declared members, their optionality and enum literal sets match the schema.
 *
 * 4. Tools without an output schema return `ToolTextResult` and say so; the others return the
 *    structured type (checked by the round trip).
 *
 * It also bounds the size of the declarations against the raw JSON the server sent.
 * `TYPEGEN_FIXTURES=/dir` adds private corpora (e.g. tool lists of connected servers);
 * `TYPEGEN_REPORT=1` prints a size table.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
	functionNames,
	moduleDeclaration,
	NO_OUTPUT_SCHEMA_NOTE,
	sanitizeComment,
	TEXT_RESULT_DECLARATIONS,
	TEXT_RESULT_TYPE,
	toNamespace
} from './index.ts';
import type { ToolTypeInput } from './types.ts';

type McpTool = {
	name: string;
	title?: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: Record<string, unknown>;
};
type Fixture = { file: string; server: string; tools: McpTool[] };

const FIXTURES = join(import.meta.dirname, 'fixtures');
const extraDir = process.env.TYPEGEN_FIXTURES;

function loadFixtures(): Fixture[] {
	const dirs = [FIXTURES, ...(extraDir && existsSync(extraDir) ? [extraDir] : [])];
	return dirs.flatMap((dir) =>
		readdirSync(dir)
			.filter((file) => file.endsWith('.json'))
			.sort()
			.map((file) => {
				const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
				return { file, server: data.server, tools: data.tools } as Fixture;
			})
	);
}

function toInputs(fixture: Fixture): ToolTypeInput[] {
	const namespace = toNamespace(fixture.server);
	const names = functionNames(fixture.tools.map((tool) => tool.name));
	return fixture.tools.map((tool) => {
		const functionName = names.get(tool.name)!;
		return {
			path: `${namespace}.${functionName}`,
			namespace,
			functionName,
			title: tool.title ?? null,
			description: tool.description ?? null,
			inputSchema: tool.inputSchema,
			outputSchema: tool.outputSchema ?? null,
			annotations: (tool.annotations as ToolTypeInput['annotations']) ?? null,
			unverified: false
		};
	});
}

/** Whitespace and JSDoc stars do not matter for "the agent can read it" */
const squash = (text: string) => text.replace(/[\s*]/g, '');

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const KNOWN = new Set([
	'type',
	'properties',
	'required',
	'items',
	'prefixItems',
	'additionalItems',
	'additionalProperties',
	'enum',
	'const',
	'anyOf',
	'oneOf',
	'allOf',
	'$ref',
	'nullable',
	'$defs',
	'definitions',
	'description',
	'title',
	'examples',
	'example',
	'$schema',
	'$id',
	'$anchor',
	'$comment',
	'id'
]);
const TAGS = [
	'format',
	'minimum',
	'exclusiveMinimum',
	'maximum',
	'exclusiveMaximum',
	'multipleOf',
	'minLength',
	'maxLength',
	'pattern',
	'minItems',
	'maxItems',
	'uniqueItems',
	'minProperties',
	'maxProperties',
	'contentMediaType',
	'contentEncoding',
	'default',
	'deprecated',
	'readOnly',
	'writeOnly'
];

type Fact = { what: string; text: string };

/** Everything a schema says that must reach the declarations */
function schemaFacts(root: unknown, where: string): Fact[] {
	const facts: Fact[] = [];
	const seen = new Set<unknown>();
	const visit = (node: unknown, path: string) => {
		if (!isObject(node) || seen.has(node)) return;
		seen.add(node);
		if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
			let target: unknown = root;
			for (const key of node.$ref.slice(2).split('/'))
				target = isObject(target) ? target[key] : undefined;
			visit(target, `${path}→${node.$ref}`);
		}
		if (typeof node.description === 'string' && node.description.trim()) {
			facts.push({ what: `${path} description`, text: sanitizeComment(node.description) });
		}
		for (const value of [
			...(Array.isArray(node.enum) ? node.enum : []),
			...('const' in node ? [node.const] : [])
		]) {
			if (value === null || typeof value !== 'object') {
				facts.push({ what: `${path} enum ${JSON.stringify(value)}`, text: JSON.stringify(value) });
			}
		}
		for (const tag of TAGS) {
			if (!(tag in node)) continue;
			const value = node[tag];
			if (
				(tag === 'minimum' || tag === 'maximum') &&
				Math.abs(value as number) === Number.MAX_SAFE_INTEGER
			)
				continue;
			const rendered =
				tag === 'default'
					? JSON.stringify(value)
					: value === true && tag !== 'exclusiveMinimum' && tag !== 'exclusiveMaximum'
						? ''
						: String(value);
			facts.push({
				what: `${path} @${tag}`,
				text: `@${tag}${tag === 'pattern' || tag === 'format' ? sanitizeComment(rendered) : rendered}`
			});
		}
		for (const example of Array.isArray(node.examples) ? node.examples.slice(0, 5) : []) {
			facts.push({ what: `${path} example`, text: `@example${JSON.stringify(example)}` });
		}
		// Keywords the type cannot carry must be there verbatim (`@schema {…}`)
		for (const key of Object.keys(node)) {
			if (KNOWN.has(key) || TAGS.includes(key)) continue;
			const json = JSON.stringify(node[key]);
			facts.push({
				what: `${path} keyword ${key}`,
				text: json.length < 1500 ? sanitizeComment(`"${key}":${json}`) : `"${key}":`
			});
		}
		if (isObject(node.properties)) {
			for (const [name, child] of Object.entries(node.properties)) {
				const key = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
				facts.push({ what: `${path}.${name} key`, text: `${key}` });
				visit(child, `${path}.${name}`);
			}
		}
		for (const key of ['items', 'additionalProperties', 'additionalItems']) {
			if (Array.isArray(node[key]))
				(node[key] as unknown[]).forEach((n, i) => visit(n, `${path}.${key}[${i}]`));
			else visit(node[key], `${path}.${key}`);
		}
		for (const key of ['prefixItems', 'anyOf', 'oneOf', 'allOf']) {
			if (Array.isArray(node[key]))
				(node[key] as unknown[]).forEach((n, i) => visit(n, `${path}.${key}[${i}]`));
		}
	};
	visit(root, where);
	return facts;
}

function toolFacts(tool: McpTool, functionName: string): Fact[] {
	const facts: Fact[] = [{ what: `${tool.name} name`, text: `${functionName}(args` }];
	if (tool.description?.trim()) {
		facts.push({ what: `${tool.name} description`, text: sanitizeComment(tool.description) });
	}
	const hints = tool.annotations ?? {};
	if (hints.readOnlyHint === true) facts.push({ what: `${tool.name} readOnly`, text: '@readOnly' });
	if (hints.readOnlyHint !== true && hints.destructiveHint === true) {
		facts.push({ what: `${tool.name} destructive`, text: '@destructive' });
	}
	if (hints.idempotentHint === true)
		facts.push({ what: `${tool.name} idempotent`, text: '@idempotent' });
	if (hints.openWorldHint === true)
		facts.push({ what: `${tool.name} openWorld`, text: '@openWorld' });
	return [
		...facts,
		...schemaFacts(tool.inputSchema, `${tool.name} input`),
		...(tool.outputSchema ? schemaFacts(tool.outputSchema, `${tool.name} output`) : [])
	];
}

/** Compiles the declarations plus a probe file aliasing each tool's argument and result types */
function compile(dts: string, inputs: ToolTypeInput[]) {
	const probe = inputs
		.map(
			(tool, i) =>
				`type Args${i} = NonNullable<Parameters<typeof ${tool.namespace}.${tool.functionName}>[0]>;\ntype Result${i} = Awaited<ReturnType<typeof ${tool.namespace}.${tool.functionName}>>;`
		)
		.join('\n');
	const files: Record<string, string> = {
		'/tools.d.ts': dts,
		'/probe.ts': `${probe}\nexport {};\n`
	};
	const options: ts.CompilerOptions = {
		strict: true,
		noEmit: true,
		target: ts.ScriptTarget.ES2023,
		lib: ['lib.es2023.d.ts'],
		types: []
	};
	const host = ts.createCompilerHost(options);
	const original = host.getSourceFile.bind(host);
	host.getSourceFile = (name, version) =>
		name in files ? ts.createSourceFile(name, files[name], version, true) : original(name, version);
	host.fileExists = (name) => name in files || ts.sys.fileExists(name);
	host.readFile = (name) => files[name] ?? ts.sys.readFile(name);
	const program = ts.createProgram(Object.keys(files), options, host);
	const diagnostics = ts
		.getPreEmitDiagnostics(program)
		.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
	const checker = program.getTypeChecker();
	const probeFile = program.getSourceFile('/probe.ts')!;
	const aliases = new Map<string, ts.Type>();
	for (const statement of probeFile.statements) {
		if (ts.isTypeAliasDeclaration(statement)) {
			aliases.set(statement.name.text, checker.getTypeAtLocation(statement.name));
		}
	}
	return { diagnostics, checker, aliases };
}

/** Schema node behind `$ref`, nullable unions and `allOf` with one object part */
function plainObject(node: unknown, root: unknown, depth = 0): Record<string, unknown> | null {
	if (!isObject(node) || depth > 6) return null;
	if (typeof node.$ref === 'string' && node.$ref.startsWith('#/')) {
		let target: unknown = root;
		for (const key of node.$ref.slice(2).split('/'))
			target = isObject(target) ? target[key] : undefined;
		return plainObject(target, root, depth + 1);
	}
	const branches = (node.anyOf ?? node.oneOf) as unknown[] | undefined;
	if (Array.isArray(branches)) {
		const real = branches.filter((b) => !(isObject(b) && b.type === 'null'));
		return real.length === 1 ? plainObject(real[0], root, depth + 1) : null;
	}
	if (node.allOf || node.not || node.if) return null;
	return isObject(node.properties) && Object.keys(node.properties).length > 0 ? node : null;
}

/** Checks members, optionality and enum literals of `type` against `schema`, recursively */
function roundTrip(
	checker: ts.TypeChecker,
	type: ts.Type,
	schema: Record<string, unknown>,
	root: unknown,
	path: string,
	problems: string[],
	depth = 0
) {
	if (depth > 5) return;
	const target = type.isUnion()
		? type.types.find((t) => !(t.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)))
		: type;
	if (!target) return;
	const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
	for (const [name, child] of Object.entries(schema.properties as Record<string, unknown>)) {
		const symbol = target.getProperty(name);
		if (!symbol) {
			problems.push(`${path}.${name}: missing member`);
			continue;
		}
		const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
		if (optional === required.has(name)) {
			problems.push(`${path}.${name}: ${optional ? 'optional' : 'required'} in .d.ts`);
		}
		const memberType = checker.getTypeOfSymbol(symbol);
		if (
			isObject(child) &&
			Array.isArray(child.enum) &&
			child.enum.every((v) => typeof v === 'string')
		) {
			const literals = (memberType.isUnion() ? memberType.types : [memberType])
				.filter((t) => t.isStringLiteral())
				.map((t) => (t as ts.StringLiteralType).value)
				.sort();
			const expected = [...new Set(child.enum as string[])].sort();
			if (JSON.stringify(literals) !== JSON.stringify(expected)) {
				problems.push(
					`${path}.${name}: enum ${JSON.stringify(literals)} ≠ ${JSON.stringify(expected)}`
				);
			}
		}
		const nested = plainObject(child, root);
		if (nested)
			roundTrip(checker, memberType, nested, root, `${path}.${name}`, problems, depth + 1);
	}
}

const fixtures = loadFixtures();
const report: string[] = [];

describe.each(fixtures)('fidelity: $file', (fixture) => {
	const inputs = toInputs(fixture);
	const raw = JSON.stringify({ tools: fixture.tools });

	it('renders declarations that compile and keep every schema fact', async () => {
		const dts = await moduleDeclaration(inputs);
		const { diagnostics, checker, aliases } = compile(dts, inputs);
		expect(diagnostics).toEqual([]);

		const text = squash(dts);
		const missing = fixture.tools
			.flatMap((tool, i) => toolFacts(tool, inputs[i].functionName))
			.filter((fact) => !text.includes(squash(fact.text)))
			.map((fact) => `${fact.what}: ${fact.text.slice(0, 120)}`);
		expect(missing).toEqual([]);

		const problems: string[] = [];
		fixture.tools.forEach((tool, i) => {
			const args = plainObject(tool.inputSchema, tool.inputSchema);
			if (args)
				roundTrip(
					checker,
					aliases.get(`Args${i}`)!,
					args,
					tool.inputSchema,
					`${tool.name}(args)`,
					problems
				);
			const output = tool.outputSchema && plainObject(tool.outputSchema, tool.outputSchema);
			if (output)
				roundTrip(
					checker,
					aliases.get(`Result${i}`)!,
					output,
					tool.outputSchema,
					`${tool.name}→`,
					problems
				);
		});
		expect(problems).toEqual([]);

		// Without an output schema the result is text, typed and documented as such
		const notText = fixture.tools.flatMap((tool, i) => {
			const result = aliases.get(`Result${i}`)!;
			const isText = result.aliasSymbol === undefined && result.symbol?.name === TEXT_RESULT_TYPE;
			return isText === !tool.outputSchema ? [] : [`${tool.name}: ${checker.typeToString(result)}`];
		});
		expect(notText).toEqual([]);
		const textTools = fixture.tools.filter((tool) => !tool.outputSchema).length;
		expect(dts.split(NO_OUTPUT_SCHEMA_NOTE).length - 1).toBe(textTools);

		// `TYPEGEN_COMPARE=/dir` with `<file>.d.ts` renderings of another typegen version: facts it lost
		const previous =
			process.env.TYPEGEN_COMPARE &&
			join(process.env.TYPEGEN_COMPARE, fixture.file.replace(/\.json$/, '.d.ts'));
		if (previous && existsSync(previous)) {
			const old = squash(readFileSync(previous, 'utf8'));
			const facts = fixture.tools.flatMap((tool, i) => toolFacts(tool, inputs[i].functionName));
			const lost = facts.filter((fact) => !old.includes(squash(fact.text)));
			report.push(
				`${fixture.file}: previous rendering misses ${lost.length}/${facts.length} facts, e.g. ${lost
					.slice(0, 3)
					.map((f) => f.what)
					.join('; ')}`
			);
		}
		report.push(
			`${fixture.file.padEnd(22)} ${String(fixture.tools.length).padStart(3)} tools  raw ${String(raw.length).padStart(7)} B ≈${String(Math.round(raw.length / 4)).padStart(6)} tok  d.ts ${String(dts.length).padStart(7)} B ≈${String(Math.round(dts.length / 4)).padStart(6)} tok  ${(dts.length / raw.length).toFixed(2)}×`
		);
		// Concise: never much larger than what the server sent, despite JSDoc framing. The
		// `ToolTextResult` declarations are a constant, declared once per script: not counted
		expect(dts.replace(TEXT_RESULT_DECLARATIONS, '').length).toBeLessThan(raw.length * 1.3);
	});

	it('is deterministic', async () => {
		expect(await moduleDeclaration([...inputs].reverse())).toBe(await moduleDeclaration(inputs));
	});
});

describe('field report: Resend-like connector', () => {
	const fixture = fixtures.find((f) => f.file === 'resendLike.json')!;
	const inputs = toInputs(fixture);

	it('keeps instruction-like descriptions and bookkeeping parameters verbatim and required', async () => {
		const dts = await moduleDeclaration(inputs);
		expect(dts).toContain('ask the user for the `from` address and an optional `replyTo`');
		expect(dts).toContain(
			'Conversation id returned by your first call to this server. Leave empty on the first call; reuse the returned value afterwards.'
		);
		const { diagnostics } = compile(dts, inputs);
		expect(diagnostics).toEqual([]);
		// Required upstream stays required: leaving out the bookkeeping fields is a type error
		const missing = compile(
			`${dts}\nasync function probe() { await resend.sendEmail({ to: ['a@b.c'], subject: 's', text: 't' }); }`,
			[]
		).diagnostics;
		expect(missing.join('\n')).toMatch(/context.*llm_model.*conversation_id|missing the following/);
	});

	it('types text results as ToolTextResult and structured ones from the schema', async () => {
		const dts = await moduleDeclaration(inputs);
		expect(dts).toMatch(/listDomains\(args: \{[\s\S]*?\}\): Promise<ToolTextResult>;/);
		expect(dts).toMatch(/sendEmail\(args: \{[\s\S]*?\}\): Promise<ToolTextResult>;/);
		expect(dts).toMatch(/getEmail\(args: \{[\s\S]*?\}\): Promise<\{/);
		const misuse = compile(
			`${dts}\nasync function probe() { const d = await resend.listDomains({ context: 'c', llm_model: 'm', conversation_id: '' }); return d.status; }`,
			[]
		).diagnostics;
		expect(misuse.join('\n')).toContain(
			"Property 'status' does not exist on type 'ToolTextResult'"
		);
	});
});

describe('fidelity report', () => {
	it('covers at least the committed corpus', () => {
		expect(fixtures.length).toBeGreaterThanOrEqual(10);
		if (process.env.TYPEGEN_REPORT) console.info(`\n${report.join('\n')}\n`);
	});
});
