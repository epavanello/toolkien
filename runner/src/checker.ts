/**
 * Type checker for agent scripts. Runs as its own `deno run` process with no permissions except
 * `--allow-read` on the cached TypeScript package (lib `.d.ts` files) and env (cleared by the
 * supervisor). It never executes the script: it parses, validates, type-checks and transpiles.
 *
 * Why not `deno check`: `deno check` runs with full read access, so `/// <reference path>` or a
 * JSON import of an arbitrary file would surface its content in the diagnostics. Here the compiler
 * host only knows the two in-memory files and the TypeScript lib files, with `noResolve`.
 *
 * stdin:  { code, declarations }
 * stdout: { ok: true, js, namespaces } | { ok: false, diagnostics }
 */
import ts from 'npm:typescript@6.0.3';
import { excerpt } from './excerpt.ts';

export const SCRIPT_FILE = '/toolkien/script.ts';
export const TOOLS_FILE = '/toolkien/tools.d.ts';
export const GLOBALS_FILE = '/toolkien/globals.d.ts';
const PREFIX = 'export default async function __toolkienMain(): Promise<unknown> {\n';
const SUFFIX = '\n}\n';
const PREFIX_LINES = 1;
const MAX_DIAGNOSTICS = 30;

/** What the sandbox provides besides the tool namespaces (see `sandbox/prelude.js`) */
const GLOBALS = `
interface Console {
	log(...data: unknown[]): void;
	info(...data: unknown[]): void;
	debug(...data: unknown[]): void;
	warn(...data: unknown[]): void;
	error(...data: unknown[]): void;
	dir(item?: unknown): void;
	table(data: unknown): void;
}
declare var console: Console;
/**
 * Thrown when a tool call fails. \`code\`: \`upstream_error\` (the tool reported an error),
 * \`invalid_params\`, \`unknown_tool\`, \`auth_required\`, \`timeout\`, \`blocked\`,
 * \`approval_rejected\`, \`limit_tool_calls\`, … \`path\`: the tool, e.g. \`github.createIssue\`.
 */
declare class ToolCallError extends Error {
	readonly code: string;
	readonly path: string;
}
declare function setTimeout(handler: (...args: unknown[]) => void, timeout?: number): number;
declare function clearTimeout(id?: number): void;
declare function setInterval(handler: (...args: unknown[]) => void, timeout?: number): number;
declare function clearInterval(id?: number): void;
declare function queueMicrotask(callback: () => void): void;
declare function structuredClone<T>(value: T): T;
declare function atob(data: string): string;
declare function btoa(data: string): string;
declare class TextEncoder {
	encode(input?: string): Uint8Array;
}
declare class TextDecoder {
	constructor(label?: string);
	decode(input?: ArrayBuffer | ArrayBufferView): string;
}
declare class URLSearchParams {
	constructor(init?: string | Record<string, string> | [string, string][]);
	append(name: string, value: string): void;
	get(name: string): string | null;
	getAll(name: string): string[];
	has(name: string): boolean;
	set(name: string, value: string): void;
	delete(name: string): void;
	toString(): string;
	entries(): IterableIterator<[string, string]>;
	[Symbol.iterator](): IterableIterator<[string, string]>;
}
declare class URL {
	constructor(url: string, base?: string | URL);
	hash: string;
	host: string;
	hostname: string;
	href: string;
	readonly origin: string;
	pathname: string;
	port: string;
	protocol: string;
	search: string;
	readonly searchParams: URLSearchParams;
	toString(): string;
	toJSON(): string;
}
`;

export type CheckInput = { code: string; declarations: string };
export type CheckOutput =
	{ ok: true; js: string; namespaces: string[] } | { ok: false; diagnostics: string };

const compilerOptions: ts.CompilerOptions = {
	target: ts.ScriptTarget.ES2023,
	module: ts.ModuleKind.ESNext,
	lib: ['lib.es2023.d.ts'],
	types: [],
	strict: true,
	noEmit: true,
	noResolve: true,
	skipLibCheck: true,
	isolatedModules: true,
	allowJs: false
};

/** Makes the declarations global: blanks top-level `export` / `import` (offsets preserved) */
function globalDeclarations(text: string): { text: string; namespaces: string[] } {
	const sf = ts.createSourceFile(TOOLS_FILE, text, ts.ScriptTarget.ES2023, true);
	const chars = text.split('');
	const blank = (start: number, end: number) => {
		for (let i = start; i < end; i++) if (chars[i] !== '\n') chars[i] = ' ';
	};
	const namespaces: string[] = [];
	for (const statement of sf.statements) {
		if (
			ts.isImportDeclaration(statement) ||
			ts.isExportDeclaration(statement) ||
			ts.isExportAssignment(statement) ||
			ts.isImportEqualsDeclaration(statement)
		) {
			blank(statement.getStart(sf), statement.end);
			continue;
		}
		const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
		for (const m of modifiers ?? []) {
			if (m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword) {
				blank(m.getStart(sf), m.end);
			}
		}
		if (ts.isVariableStatement(statement)) {
			for (const d of statement.declarationList.declarations) {
				if (ts.isIdentifier(d.name)) namespaces.push(d.name.text);
			}
		} else if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
			namespaces.push(statement.name.text);
		}
	}
	return { text: chars.join(''), namespaces: [...new Set(namespaces)] };
}

function forbiddenSyntax(sf: ts.SourceFile): ts.Diagnostic[] {
	const found: ts.Diagnostic[] = [];
	const report = (node: ts.Node, message: string) =>
		found.push({
			file: sf,
			start: node.getStart(sf),
			length: node.getWidth(sf),
			messageText: message,
			category: ts.DiagnosticCategory.Error,
			code: 0
		});
	const visit = (node: ts.Node) => {
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
			report(node, 'Dynamic import() is not allowed: only the tool namespaces are available.');
		} else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) {
			report(node, 'import.meta is not allowed.');
		} else if (ts.isImportTypeNode(node)) report(node, 'import() types are not allowed.');
		ts.forEachChild(node, visit);
	};
	visit(sf);
	return found;
}

type HintContext = {
	program: ts.Program;
	script: ts.SourceFile;
	namespaces: string[];
};

/** Innermost node of `sf` that contains `position` */
function nodeAt(sf: ts.SourceFile, position: number): ts.Node {
	let found: ts.Node = sf;
	const visit = (node: ts.Node) => {
		if (position >= node.getStart(sf) && position < node.end) {
			found = node;
			ts.forEachChild(node, visit);
		}
	};
	ts.forEachChild(sf, visit);
	return found;
}

/** `ns.fn` when `node` is (inside) a call to a tool function */
function enclosingToolCall(node: ts.Node, namespaces: string[]): string | null {
	for (let current: ts.Node | undefined = node; current; current = current.parent) {
		if (
			ts.isCallExpression(current) &&
			ts.isPropertyAccessExpression(current.expression) &&
			ts.isIdentifier(current.expression.expression) &&
			namespaces.includes(current.expression.expression.text)
		) {
			return `${current.expression.expression.text}.${current.expression.name.text}`;
		}
	}
	return null;
}

/** Closest names by edit distance (for "did you mean") */
function closest(name: string, candidates: string[], max = 3): string[] {
	const distance = (a: string, b: string) => {
		const row = Array.from({ length: b.length + 1 }, (_, i) => i);
		for (let i = 1; i <= a.length; i++) {
			let previous = row[0];
			row[0] = i;
			for (let j = 1; j <= b.length; j++) {
				const current = row[j];
				row[j] = Math.min(
					row[j] + 1,
					row[j - 1] + 1,
					previous + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1)
				);
				previous = current;
			}
		}
		return row[b.length];
	};
	return candidates
		.map((candidate) => ({ candidate, d: distance(name, candidate) }))
		.filter(({ d, candidate }) => d <= Math.max(2, Math.floor(candidate.length / 3)))
		.sort((a, b) => a.d - b.d)
		.slice(0, max)
		.map(({ candidate }) => candidate);
}

/** One actionable line for the agent, keyed on what went wrong where */
function hintFor(d: ts.Diagnostic, ctx: HintContext): string | null {
	if (d.file?.fileName !== SCRIPT_FILE || d.start === undefined) return null;
	const node = nodeAt(ctx.script, d.start);
	const checker = ctx.program.getTypeChecker();
	const known = ctx.namespaces.length
		? `Tool namespaces in this workspace: ${ctx.namespaces.join(', ')}.`
		: 'No tool namespace is available to this script (no connector, or every tool is blocked).';
	switch (d.code) {
		case 2304: // Cannot find name 'x'
		case 2552: {
			const name = ts.isIdentifier(node) ? node.text : '';
			const near = closest(name, ctx.namespaces);
			return `${near.length ? `Did you mean ${near.map((n) => `\`${n}\``).join(' or ')}? ` : ''}${known} Only the namespaces declared by tools_describe exist; there is no fetch, require or import.`;
		}
		case 2339: // Property 'x' does not exist on type …
		case 2551: {
			const parent = node.parent;
			if (
				ts.isIdentifier(node) &&
				parent &&
				ts.isPropertyAccessExpression(parent) &&
				ts.isIdentifier(parent.expression) &&
				ctx.namespaces.includes(parent.expression.text)
			) {
				const ns = parent.expression.text;
				const members = checker
					.getTypeAtLocation(parent.expression)
					.getProperties()
					.map((p) => p.name);
				const near = closest(node.text, members);
				return `\`${ns}\` has no tool \`${node.text}\`.${near.length ? ` Did you mean ${near.map((n) => `\`${ns}.${n}\``).join(' or ')}?` : ''} Its tools: ${members.slice(0, 40).join(', ')}${members.length > 40 ? ', …' : ''}. Blocked tools are not declared.`;
			}
			if (
				parent &&
				ts.isPropertyAccessExpression(parent) &&
				checker.getTypeAtLocation(parent.expression).getSymbol()?.getName() === 'ToolTextResult'
			) {
				return 'This tool has no output schema: its result is `ToolTextResult`, text as the server wrote it (often not JSON). Read `.text` (or `.content`); call `.json()` only if the text is JSON.';
			}
			return null;
		}
		case 18046: // 'x' is of type 'unknown'
		case 2571: {
			const declaration = ts.isIdentifier(node)
				? checker.getSymbolAtLocation(node)?.valueDeclaration
				: undefined;
			if (declaration && ts.isCatchClause(declaration.parent)) {
				return '`catch (e)` gives `unknown`: use `(e as ToolCallError).code` / `.path`, or `(e as Error).message`.';
			}
			return 'This value is typed `unknown` (e.g. `.json()` without a type argument, or an untyped part of a schema): log a sample first, then narrow it (`const r = x as { items: Item[] }`) or check fields at runtime.';
		}
	}
	const call = enclosingToolCall(node, ctx.namespaces);
	if (call) {
		return `In the arguments of \`${call}\`: compare with its declaration (tools_describe ["${call}"]); optional members end with \`?\`, enums accept only the listed literals.`;
	}
	return null;
}

function formatDiagnostics(
	diagnostics: readonly ts.Diagnostic[],
	codeLines: string[],
	hints?: HintContext
): string {
	const lines: string[] = [];
	// The same hint under every occurrence of one mistake is noise: say it once
	const hinted = new Set<string>();
	for (const d of diagnostics.slice(0, MAX_DIAGNOSTICS)) {
		const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
		const tag = d.code ? `error TS${d.code}` : 'error';
		if (!d.file || d.start === undefined) {
			lines.push(`${tag}: ${message}`);
			continue;
		}
		const pos = d.file.getLineAndCharacterOfPosition(d.start);
		if (d.file.fileName === SCRIPT_FILE) {
			const line = pos.line - PREFIX_LINES + 1;
			if (line < 1 || line > codeLines.length) {
				lines.push(`script.ts - ${tag}: ${message}`);
				continue;
			}
			lines.push(`script.ts:${line}:${pos.character + 1} - ${tag}: ${message}`);
			lines.push(...excerpt(codeLines[line - 1] ?? '', pos.character));
			const hint = hints ? hintFor(d, hints) : null;
			if (hint && !hinted.has(hint)) {
				hinted.add(hint);
				lines.push(`  hint: ${hint}`);
			}
		} else {
			const name = d.file.fileName === TOOLS_FILE ? 'tools.d.ts' : 'lib';
			lines.push(`${name}:${pos.line + 1}:${pos.character + 1} - ${tag}: ${message}`);
		}
	}
	if (diagnostics.length > MAX_DIAGNOSTICS) {
		lines.push(`… and ${diagnostics.length - MAX_DIAGNOSTICS} more errors`);
	}
	return lines.join('\n');
}

export function check(input: CheckInput): CheckOutput {
	const wrapped = PREFIX + input.code + SUFFIX;
	const codeLines = input.code.split('\n');
	const tools = globalDeclarations(input.declarations);
	const defaultLib = ts.getDefaultLibFilePath(compilerOptions).replaceAll('\\', '/');
	const libDir = defaultLib.slice(0, defaultLib.lastIndexOf('/'));
	const files = new Map<string, string>([
		[SCRIPT_FILE, wrapped],
		[TOOLS_FILE, tools.text],
		[GLOBALS_FILE, GLOBALS]
	]);
	const libPath = (name: string) => {
		const normalized = name.replaceAll('\\', '/');
		const base = normalized.slice(libDir.length + 1);
		return normalized.startsWith(libDir + '/') && /^lib\.[a-z0-9]+(\.[a-z0-9]+)*\.d\.ts$/.test(base)
			? normalized
			: null;
	};
	const sourceFiles = new Map<string, ts.SourceFile>();
	const host: ts.CompilerHost = {
		getSourceFile(name, languageVersion) {
			const cached = sourceFiles.get(name);
			if (cached) return cached;
			let text = files.get(name);
			if (text === undefined) {
				const lib = libPath(name);
				if (lib) text = Deno.readTextFileSync(lib);
			}
			if (text === undefined) return undefined;
			const sf = ts.createSourceFile(name, text, languageVersion, true);
			sourceFiles.set(name, sf);
			return sf;
		},
		getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
		writeFile: () => {},
		getCurrentDirectory: () => '/toolkien',
		getCanonicalFileName: (f) => f,
		useCaseSensitiveFileNames: () => true,
		getNewLine: () => '\n',
		fileExists: (f) => files.has(f) || libPath(f) !== null,
		readFile: (f) => files.get(f),
		directoryExists: () => true,
		getDirectories: () => []
	};

	const program = ts.createProgram([GLOBALS_FILE, TOOLS_FILE, SCRIPT_FILE], compilerOptions, host);
	const script = program.getSourceFile(SCRIPT_FILE)!;

	// Syntax first: an unbalanced brace could otherwise escape the function wrapper
	const syntax = program.getSyntacticDiagnostics(script);
	if (syntax.length > 0) return { ok: false, diagnostics: formatDiagnostics(syntax, codeLines) };
	const [main, ...rest] = script.statements;
	if (
		rest.length > 0 ||
		!main ||
		!ts.isFunctionDeclaration(main) ||
		main.name?.text !== '__toolkienMain' ||
		main.end !== wrapped.length - 1
	) {
		return {
			ok: false,
			diagnostics:
				'The script is the body of an async function: top-level import/export and unbalanced braces are not allowed.'
		};
	}
	const forbidden = forbiddenSyntax(script);
	if (forbidden.length > 0) {
		return { ok: false, diagnostics: formatDiagnostics(forbidden, codeLines) };
	}

	const diagnostics = [
		...program.getSyntacticDiagnostics(),
		...program.getGlobalDiagnostics(),
		...program.getSemanticDiagnostics()
	].filter((d) => d.category === ts.DiagnosticCategory.Error);
	if (diagnostics.length > 0) {
		return {
			ok: false,
			diagnostics: formatDiagnostics(diagnostics, codeLines, {
				program,
				script,
				namespaces: tools.namespaces
			})
		};
	}

	// The inline source map makes Deno report runtime errors at `script.ts:<line>:<col>`
	const js = ts.transpileModule(wrapped, {
		fileName: 'script.ts',
		compilerOptions: {
			target: ts.ScriptTarget.ES2023,
			module: ts.ModuleKind.ESNext,
			inlineSourceMap: true,
			importHelpers: false
		},
		reportDiagnostics: false
	}).outputText;
	return { ok: true, js, namespaces: tools.namespaces };
}

if (import.meta.main) {
	const input = JSON.parse(await new Response(Deno.stdin.readable).text()) as CheckInput;
	let output: CheckOutput;
	try {
		output = check(input);
	} catch (error) {
		output = {
			ok: false,
			diagnostics: `Type checker failed: ${
				error instanceof Error ? error.message : 'unknown error'
			}`
		};
	}
	await Deno.stdout.write(new TextEncoder().encode(JSON.stringify(output)));
}
