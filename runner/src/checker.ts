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
/** Thrown when a tool call fails; \`code\` is a stable category */
declare class ToolCallError extends Error {
	readonly code: string;
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

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[], codeLines: string[]): string {
	const lines: string[] = [];
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
			const source = codeLines[line - 1] ?? '';
			if (source.length <= 300) lines.push(`  ${source}`, `  ${' '.repeat(pos.character)}^`);
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
		return { ok: false, diagnostics: formatDiagnostics(diagnostics, codeLines) };
	}

	const js = ts.transpileModule(wrapped, {
		compilerOptions: {
			target: ts.ScriptTarget.ES2023,
			module: ts.ModuleKind.ESNext,
			sourceMap: false,
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
