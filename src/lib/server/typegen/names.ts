/**
 * Identifier normalisation for generated TypeScript: camelCase tool names, namespaces that are
 * valid `declare const` names, and deterministic collision resolution.
 */

/** Words that cannot be a `declare const` name (reserved, strict-mode or contextual) */
const RESERVED = new Set([
	'arguments',
	'await',
	'break',
	'case',
	'catch',
	'class',
	'const',
	'continue',
	'debugger',
	'default',
	'delete',
	'do',
	'else',
	'enum',
	'eval',
	'export',
	'extends',
	'false',
	'finally',
	'for',
	'function',
	'if',
	'implements',
	'import',
	'in',
	'instanceof',
	'interface',
	'let',
	'new',
	'null',
	'package',
	'private',
	'protected',
	'public',
	'return',
	'static',
	'super',
	'switch',
	'this',
	'throw',
	'true',
	'try',
	'typeof',
	'undefined',
	'var',
	'void',
	'while',
	'with',
	'yield',
	'any',
	'unknown',
	'never',
	'string',
	'number',
	'boolean',
	'symbol',
	'object',
	'type',
	'declare',
	'namespace',
	'module',
	'global'
]);

/**
 * Globals a script may need: a namespace with one of these names would shadow it, so it gets a
 * suffix instead (`json` is fine, `JSON` is not, the check is case-sensitive).
 */
const GLOBALS = new Set([
	'console',
	'JSON',
	'Math',
	'Date',
	'Promise',
	'Array',
	'Object',
	'String',
	'Number',
	'Boolean',
	'Error',
	'Map',
	'Set',
	'RegExp',
	'Symbol',
	'Intl',
	'Reflect',
	'Proxy',
	'globalThis',
	'Deno',
	'fetch',
	'crypto',
	'structuredClone',
	'setTimeout',
	'clearTimeout',
	'queueMicrotask',
	'atob',
	'btoa',
	'toolkien'
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Whether `name` can be used as-is as a property key in a type literal */
export const isIdentifier = (name: string) => IDENTIFIER.test(name);

/** Splits `search_threads`, `search-threads`, `SearchThreads`, `getHTTPResponse` into words */
function words(name: string): string[] {
	return (
		name
			.normalize('NFKD')
			// drop combining marks and anything that is not ASCII alphanumeric
			.replace(/[̀-ͯ]/g, '')
			.replace(/[^A-Za-z0-9]+/g, ' ')
			// `getHTTPResponse` → `get HTTP Response`, `searchThreads` → `search Threads`
			.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
			.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
			.trim()
			.split(/\s+/)
			.filter(Boolean)
	);
}

/**
 * `search_threads` / `search-threads` / `SearchThreads` / `search threads` → `searchThreads`.
 * Non-ASCII letters are folded (`búsqueda` → `busqueda`); a leading digit gets a `_` prefix;
 * an empty result becomes `tool`.
 */
export function toCamelCase(name: string): string {
	const parts = words(name).map((word) => word.toLowerCase());
	if (parts.length === 0) return 'tool';
	const camel = parts
		.map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
		.join('');
	return /^[0-9]/.test(camel) ? `_${camel}` : camel;
}

/**
 * A namespace usable as `declare const <ns>`: camelCase, not a reserved word, not shadowing a
 * global the scripts use (`delete` → `deleteTools`, `console` → `consoleTools`).
 */
export function toNamespace(name: string): string {
	const camel = toCamelCase(name);
	return RESERVED.has(camel) || GLOBALS.has(camel) ? `${camel}Tools` : camel;
}

/**
 * First free name among `desired`, `<prefix><Desired>` (when a prefix is given), then
 * `<desired>2`, `<desired>3`… Deterministic for the same inputs.
 */
export function uniqueName(desired: string, taken: ReadonlySet<string>, prefix?: string): string {
	if (!taken.has(desired)) return desired;
	if (prefix) {
		const prefixed = toCamelCase(`${prefix} ${desired}`);
		if (!taken.has(prefixed) && !RESERVED.has(prefixed) && !GLOBALS.has(prefixed)) {
			return prefixed;
		}
	}
	for (let n = 2; ; n++) {
		const candidate = `${desired}${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/**
 * camelCase function names for the upstream tool names of one connector, unique inside it.
 * Sorted by upstream name first so `search_threads` + `searchThreads` always map the same way.
 */
export function functionNames(upstreamNames: string[]): Map<string, string> {
	const taken = new Set<string>();
	const result = new Map<string, string>();
	for (const upstream of [...new Set(upstreamNames)].sort()) {
		const name = uniqueName(toCamelCase(upstream), taken);
		taken.add(name);
		result.set(upstream, name);
	}
	return result;
}
