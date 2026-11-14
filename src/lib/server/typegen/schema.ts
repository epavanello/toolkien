/**
 * A small JSON Schema → TypeScript type emitter, written for tool schemas.
 *
 * Why not `json-schema-to-typescript`: it emits named `interface`s (global names that collide
 * across tools in one `.d.ts`), its output depends on `title`s chosen by the upstream, it is
 * async and heavy, and it copies descriptions verbatim into comments. Tool signatures need the
 * opposite: inline anonymous types, deterministic text, and every upstream string escaped
 * because it is untrusted (tool poisoning).
 *
 * Fidelity contract (checked by `fidelity.spec.ts` against real tool lists): every keyword of
 * the schema ends up somewhere the agent reads it.
 * - Structure becomes the type: `type`, `properties`, `required`, `items`/`prefixItems`,
 *   `enum`/`const` (any JSON value), `anyOf`/`oneOf`/`allOf`, local `$ref` (named aliases for
 *   shared and recursive definitions when a registry is given), `additionalProperties`,
 *   `nullable`.
 * - Descriptions, titles and constraints become JSDoc: on the member for properties, inline
 *   (`/** … *\/ T`) for array items, union branches and map values. Constraints are standard
 *   JSON Schema names as tags: `@integer @minimum 1 @maxLength 50 @pattern ^a$ @format uri
 *   @default 10 @example "x" @deprecated`.
 * - Anything else (`not`, `if`/`then`, `propertyNames`, `patternProperties`, typed
 *   `additionalProperties` next to properties, `x-*` extensions, …) is kept verbatim as
 *   `@schema {…}` compact JSON. Nothing is silently dropped except pure metadata (`$schema`,
 *   `$id`, `$comment`, `$anchor`) and titles that only repeat the property name.
 * - Past `maxDepth` the type is `unknown` and the subschema is attached as `@schema` JSON.
 */

export type Schema = Record<string, unknown> | boolean;

export type EmitOptions = {
	/** Maximum nesting before falling back to `unknown` + raw schema (default 12) */
	maxDepth?: number;
	/** Properties emitted per object before falling back to an index signature (default 200) */
	maxProperties?: number;
	/** Named aliases for shared / recursive `$ref` targets (see `AliasRegistry`) */
	aliases?: AliasRegistry;
	/** Stable id of this root schema inside the registry (`in:send`, `out:send`) */
	rootId?: string;
	/** PascalCase prefix used when an alias name collides (`Send` → `SendFilter`) */
	ownerName?: string;
};

type Context = {
	root: Schema;
	rootId: string;
	ownerName: string;
	depth: number;
	indent: number;
	refs: string[];
	maxDepth: number;
	maxProperties: number;
	aliases: AliasRegistry | null;
};

/** Upstream descriptions are kept whole up to this size (64 KB), then cut with a notice */
export const MAX_DESCRIPTION_LENGTH = 64_000;
/** JSON values in tags (`@default`, `@example`, `@schema`) */
const MAX_JSON_LENGTH = 2_000;

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Makes untrusted text safe inside a `/** … *\/` block: no comment terminator, no control
 * characters, and no line that starts with `@` (an upstream must not be able to fake our
 * `@readOnly` tags). Text longer than `maxLength` is cut with an explicit notice.
 */
export function sanitizeComment(text: string, maxLength = MAX_DESCRIPTION_LENGTH): string {
	let clean = text
		.replace(/\r\n?/g, '\n')
		// eslint-disable-next-line no-control-regex -- stripping control characters on purpose
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, '')
		.replace(/\*\//g, '*\\/')
		.replace(/^(\s*)@/gm, '$1\\@')
		.trim();
	if (clean.length > maxLength) {
		const cut = clean.length - maxLength;
		clean = `${clean.slice(0, maxLength).trimEnd()}… [${cut} more characters cut by Toolkien]`;
	}
	return clean;
}

/** A JSDoc block (or nothing) at `indent` tabs; `lines` may contain newlines */
export function jsDoc(lines: string[], indent: number): string {
	const body = lines.flatMap((line) => line.split('\n')).map((line) => line.trimEnd());
	while (body.length > 0 && body[body.length - 1] === '') body.pop();
	while (body.length > 0 && body[0] === '') body.shift();
	if (body.length === 0) return '';
	const pad = '\t'.repeat(indent);
	if (body.length === 1) return `${pad}/** ${body[0]} */\n`;
	return `${pad}/**\n${body.map((line) => `${pad} *${line ? ` ${line}` : ''}`).join('\n')}\n${pad} */\n`;
}

/** Single-line `/** … *\/ ` prefix for a type in an inline position (or nothing) */
function inlineDoc(lines: string[]): string {
	const text = lines
		.join(' ')
		.replace(/\s*\n\s*/g, ' ')
		.trim();
	return text ? `/** ${text} */ ` : '';
}

/** Compact JSON of an upstream value for a tag, sanitized and capped */
function jsonText(value: unknown, max = MAX_JSON_LENGTH): string {
	let text: string | undefined;
	try {
		text = JSON.stringify(value);
	} catch {
		text = undefined;
	}
	return sanitizeComment(text ?? String(value), max);
}

/**
 * A JSON value as a TypeScript literal type. JSON is valid type syntax (`{"a": [1, null]}`
 * is an object type with a tuple member), so `enum`/`const` of any JSON value stay exact.
 */
const literal = (value: unknown): string | null => {
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'number';
	if (typeof value === 'boolean') return String(value);
	if (Array.isArray(value)) {
		const members = value.map(literal);
		return members.includes(null) ? null : `[${members.join(', ')}]`;
	}
	if (isObject(value)) {
		const entries = Object.entries(value).map(([key, v]) => {
			const type = literal(v);
			return type === null ? null : `${JSON.stringify(key)}: ${type}`;
		});
		return entries.includes(null) ? null : `{ ${entries.join('; ')} }`;
	}
	return null;
};

type Operator = '|' | '&';

/** Top-level `|` / `&` operators of a type (outside brackets, string literals and comments) */
function topLevelOperators(type: string): Set<Operator> {
	const found = new Set<Operator>();
	let depth = 0;
	let quote = false;
	for (let i = 0; i < type.length; i++) {
		const char = type[i];
		if (!quote && char === '/' && type[i + 1] === '*') {
			// Comments are sanitized, so the first `*/` is their own terminator
			const end = type.indexOf('*/', i + 2);
			if (end === -1) return found;
			i = end + 1;
			continue;
		}
		if (quote) {
			if (char === '\\') i++;
			else if (char === '"') quote = false;
		} else if (char === '"') quote = true;
		else if (char === '{' || char === '[' || char === '(' || char === '<') depth++;
		else if (char === '}' || char === ']' || char === ')' || char === '>') depth--;
		else if (depth === 0 && (char === '|' || char === '&')) found.add(char);
	}
	return found;
}

/** Parentheses for `T[]` and for unions inside intersections */
const wrap = (type: string) => (topLevelOperators(type).size > 0 ? `(${type})` : type);

const uniqueJoin = (types: string[], separator: ' | ' | ' & ') => {
	const seen = [...new Set(types)];
	if (separator === ' | ' && seen.includes('unknown')) return 'unknown';
	if (seen.length === 1) return seen[0];
	// Unions flatten (`a | (b | c)` is `a | b | c`) and `&` binds tighter than `|`
	return separator === ' | ' ? seen.join(' | ') : seen.map(wrap).join(' & ');
};

function resolveRef(root: Schema, ref: string): Schema | undefined {
	if (ref === '#') return root;
	if (!ref.startsWith('#/')) return undefined;
	let node: unknown = root;
	for (const raw of ref.slice(2).split('/')) {
		let key: string;
		try {
			key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
		} catch {
			return undefined;
		}
		if (!isObject(node)) return undefined;
		node = node[key];
	}
	return isObject(node) || typeof node === 'boolean' ? node : undefined;
}

function propertyKey(name: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

// ─── Named aliases for `$ref` targets ─────────────────────────────────────────────────────

/** `#/$defs/order_item` → `OrderItem`, always a valid identifier */
export function pascalCase(text: string): string {
	const words = text
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
	const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
	return /^[A-Za-z_$]/.test(name) ? name : `T${name}`;
}

/** Keys sorted at every level, for content equality of alias bodies */
function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (isObject(value)) {
		const keys = Object.keys(value).sort();
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/**
 * Collects named type aliases for `$ref` targets that are recursive or used more than once,
 * so a `.d.ts` can declare them once (`declare namespace ns { type Filter = … }`) instead of
 * inlining copies, and recursive definitions keep their real shape instead of `unknown`.
 * Names come from the definition key; the same name with different content gets the owner's
 * function name as prefix.
 */
export class AliasRegistry {
	readonly namespace: string;
	/** alias name → { body, docs } in creation order */
	readonly declarations = new Map<string, { type: string; docs: string[] }>();
	/** `${rootId} ${ref}` → alias name */
	#byRef = new Map<string, string>();
	/** content hash → alias name */
	#byContent = new Map<string, string>();
	/** refs whose body is being emitted (recursion detection) */
	#inProgress = new Map<string, { name: string; recursive: boolean }>();
	/** per root: how many times each `$ref` string occurs */
	#counts = new WeakMap<object, Map<string, number>>();

	constructor(namespace: string) {
		this.namespace = namespace;
	}

	/** Whether `$ref` of the root `rootId` is emitted as an alias (its docs live on the alias) */
	isAliasedRef(rootId: string, ref: string): boolean {
		return this.#byRef.has(`${rootId} ${ref}`);
	}

	refCount(root: Schema, ref: string): number {
		if (!isObject(root)) return 0;
		let counts = this.#counts.get(root);
		if (!counts) {
			counts = new Map();
			const walk = (node: unknown) => {
				if (Array.isArray(node)) return node.forEach(walk);
				if (!isObject(node)) return;
				if (typeof node.$ref === 'string')
					counts!.set(node.$ref, (counts!.get(node.$ref) ?? 0) + 1);
				Object.values(node).forEach(walk);
			};
			walk(root);
			this.#counts.set(root, counts);
		}
		return counts.get(ref) ?? 0;
	}

	#freeName(base: string, owner: string, content: string): string {
		const existing = this.#byContent.get(content);
		if (existing) return existing;
		const taken = (name: string) =>
			this.declarations.has(name) || [...this.#inProgress.values()].some((p) => p.name === name);
		if (!taken(base)) return base;
		if (!taken(`${owner}${base}`)) return `${owner}${base}`;
		let i = 2;
		while (taken(`${base}${i}`)) i++;
		return `${base}${i}`;
	}

	/**
	 * The type for `$ref`: the qualified alias name, or the inline body. `emitBody` renders the
	 * target (it may call back here for nested refs).
	 */
	typeFor(
		key: string,
		ref: string,
		target: Schema,
		count: number,
		owner: string,
		emitBody: () => { type: string; docs: string[] }
	): { type: string; aliased: boolean } {
		const known = this.#byRef.get(key);
		if (known) return { type: `${this.namespace}.${known}`, aliased: true };
		const pending = this.#inProgress.get(key);
		if (pending) {
			pending.recursive = true;
			return { type: `${this.namespace}.${pending.name}`, aliased: true };
		}
		const content = canonical(target);
		const shared = this.#byContent.get(content);
		if (shared) {
			this.#byRef.set(key, shared);
			return { type: `${this.namespace}.${shared}`, aliased: true };
		}
		const base = pascalCase(ref.split('/').pop() || 'Type');
		const name = this.#freeName(base, owner, content);
		const progress = { name, recursive: false };
		this.#inProgress.set(key, progress);
		const body = emitBody();
		this.#inProgress.delete(key);
		// Short, non-recursive definitions used once stay inline: an alias would not save anything
		if (!progress.recursive && (count < 2 || body.type.length < 40)) {
			return { type: body.type, aliased: false };
		}
		this.declarations.set(name, body);
		this.#byRef.set(key, name);
		this.#byContent.set(content, name);
		return { type: `${this.namespace}.${name}`, aliased: true };
	}
}

// ─── Docs ─────────────────────────────────────────────────────────────────────────────────

/** Keywords rendered into the type itself */
const STRUCTURAL = new Set([
	'type',
	'properties',
	'required',
	'items',
	'prefixItems',
	'additionalItems',
	'enum',
	'const',
	'anyOf',
	'oneOf',
	'allOf',
	'$ref',
	'nullable',
	'$defs',
	'definitions'
]);

/** Pure metadata: carries nothing an agent needs to call the tool */
const METADATA = new Set([
	'$schema',
	'$id',
	'$anchor',
	'$dynamicAnchor',
	'$vocabulary',
	'$comment'
]);

/** Constraints rendered as `@name value` tags, in this order */
const TAGS: [keyword: string, render: (value: unknown) => string | null][] = [
	['format', (v) => (typeof v === 'string' ? sanitizeComment(v, 200) : null)],
	['minimum', (v) => (typeof v === 'number' ? String(v) : null)],
	['exclusiveMinimum', (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : null)],
	['maximum', (v) => (typeof v === 'number' ? String(v) : null)],
	['exclusiveMaximum', (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : null)],
	['multipleOf', (v) => (typeof v === 'number' ? String(v) : null)],
	['minLength', (v) => (typeof v === 'number' ? String(v) : null)],
	['maxLength', (v) => (typeof v === 'number' ? String(v) : null)],
	['pattern', (v) => (typeof v === 'string' ? sanitizeComment(v, MAX_JSON_LENGTH) : null)],
	['minItems', (v) => (typeof v === 'number' ? String(v) : null)],
	['maxItems', (v) => (typeof v === 'number' ? String(v) : null)],
	['uniqueItems', (v) => (v === true ? '' : null)],
	['minProperties', (v) => (typeof v === 'number' ? String(v) : null)],
	['maxProperties', (v) => (typeof v === 'number' ? String(v) : null)],
	['contentMediaType', (v) => (typeof v === 'string' ? sanitizeComment(v, 200) : null)],
	['contentEncoding', (v) => (typeof v === 'string' ? sanitizeComment(v, 200) : null)],
	['default', (v) => (v === undefined ? null : jsonText(v))],
	['deprecated', (v) => (v === true ? '' : null)],
	['readOnly', (v) => (v === true ? '' : null)],
	['writeOnly', (v) => (v === true ? '' : null)]
];
const TAG_KEYWORDS = new Set(TAGS.map(([k]) => k));
const SAFE_BOUND = new Set(['minimum', 'maximum']);

/** Keywords that shape a type; an `allOf` part without any of them only adds constraints */
const TYPE_KEYWORDS = [
	'type',
	'properties',
	'items',
	'prefixItems',
	'enum',
	'const',
	'anyOf',
	'oneOf',
	'allOf',
	'$ref',
	'additionalProperties',
	'patternProperties',
	'nullable'
];
const typeless = (part: unknown): part is Record<string, unknown> =>
	isObject(part) && !TYPE_KEYWORDS.some((key) => key in part);

/** `query` vs `Query` / `query_text` vs `Query Text`: a title that only repeats the name */
const sameWords = (a: string, b: string) =>
	a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * What a schema node says beyond its type: description (and a title that adds something),
 * `@integer`, constraint tags, examples, and `@schema {…}` for keywords the type cannot carry.
 * `name` is the property name (titles repeating it are dropped); `omitDescription` skips text
 * already shown by the caller (the tool description).
 */
export function schemaDocs(
	schema: Schema,
	options: {
		name?: string;
		omitDescription?: string;
		/** Roots: titles like `search_threadsArguments` are generator noise */
		skipTitle?: boolean;
		extra?: Record<string, unknown>;
	} = {}
): string[] {
	if (!isObject(schema)) return [];
	const lines: string[] = [];
	const description =
		typeof schema.description === 'string' ? sanitizeComment(schema.description) : '';
	const omitted = options.omitDescription?.trim();
	if (description && description !== omitted) lines.push(description);
	if (!options.skipTitle && typeof schema.title === 'string' && schema.title.trim()) {
		const title = sanitizeComment(schema.title, 500);
		const redundant =
			(options.name !== undefined && sameWords(title, options.name)) ||
			description.includes(title) ||
			title === omitted;
		if (!redundant) lines.unshift(lines.length ? `${title}:` : title);
	}

	const tags: string[] = [];
	const types = Array.isArray(schema.type) ? schema.type : [schema.type];
	if (types.includes('integer') && !types.includes('number')) tags.push('@integer');
	for (const [keyword, render] of TAGS) {
		if (!(keyword in schema)) continue;
		// `z.number().int()` bounds (±2^53-1) say nothing beyond `@integer`
		if (
			SAFE_BOUND.has(keyword) &&
			Math.abs(schema[keyword] as number) === Number.MAX_SAFE_INTEGER
		) {
			continue;
		}
		const value = render(schema[keyword]);
		if (value !== null) tags.push(value ? `@${keyword} ${value}` : `@${keyword}`);
	}
	const examples = Array.isArray(schema.examples)
		? schema.examples
		: 'example' in schema
			? [schema.example]
			: [];
	for (const example of examples.slice(0, 5)) tags.push(`@example ${jsonText(example, 500)}`);
	if (Array.isArray(schema.examples) && schema.examples.length > 5) {
		tags.push(`(+${schema.examples.length - 5} more examples)`);
	}

	// Everything the type and the tags do not carry, verbatim
	const raw: Record<string, unknown> = { ...options.extra };
	for (const [key, value] of Object.entries(schema)) {
		if (
			STRUCTURAL.has(key) ||
			METADATA.has(key) ||
			TAG_KEYWORDS.has(key) ||
			key === 'description' ||
			key === 'title' ||
			key === 'examples' ||
			key === 'example' ||
			(key === 'id' && typeof value === 'string') ||
			(key === 'additionalProperties' && !keepAdditional(schema))
		) {
			continue;
		}
		raw[key] = value;
	}
	// `allOf` parts that only constrain (`if`/`then`, `not`, `required`) cannot be typed
	if (Array.isArray(schema.allOf) && schema.allOf.some(typeless)) {
		raw.allOf = schema.allOf.filter(typeless);
	}
	if (Object.keys(raw).length > 0) tags.push(`@schema ${jsonText(raw)}`);
	if (tags.length > 0) lines.push(tags.join(' '));
	return lines;
}

/**
 * `additionalProperties` is shown verbatim only when the type cannot carry it: a schema next to
 * named properties (the index signature has to stay `unknown`).
 */
function keepAdditional(schema: Record<string, unknown>): boolean {
	const additional = schema.additionalProperties;
	if (additional === undefined || typeof additional === 'boolean') return false;
	return isObject(schema.properties) && Object.keys(schema.properties).length > 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────────────────

/** Where a schema is emitted: a member (docs go to the member JSDoc) or inline (docs prefix) */
type Position = 'member' | 'inline';

function emitObject(schema: Record<string, unknown>, ctx: Context): string {
	const properties = isObject(schema.properties) ? schema.properties : {};
	const requiredList = Array.isArray(schema.required)
		? schema.required.filter((r): r is string => typeof r === 'string')
		: [];
	const required = new Set(requiredList);
	const all = Object.keys(properties);
	const names = all.slice(0, ctx.maxProperties);
	const truncated = all.length > names.length;
	// Required names without a schema still have to be passed
	const bare = requiredList.filter((name) => !(name in properties));
	const additional = schema.additionalProperties;
	const open =
		truncated ||
		additional === true ||
		isObject(additional) ||
		isObject(schema.patternProperties) ||
		(additional === undefined && names.length === 0);

	if (names.length === 0 && bare.length === 0) {
		if (!open) return 'Record<string, never>';
		return isObject(additional) && !truncated
			? `Record<string, ${emit(additional, { ...ctx, depth: ctx.depth + 1 }, 'inline')}>`
			: 'Record<string, unknown>';
	}

	const inner = { ...ctx, depth: ctx.depth + 1, indent: ctx.indent + 1 };
	const pad = '\t'.repeat(ctx.indent + 1);
	let body = '';
	for (const name of names) {
		const property = properties[name] as Schema;
		const type = emit(property, inner, 'member');
		body += jsDoc(memberDocs(property, name, ctx), ctx.indent + 1);
		const optional = required.has(name) ? '' : '?';
		body += `${pad}${propertyKey(name)}${optional}: ${type};\n`;
	}
	for (const name of bare) body += `${pad}${propertyKey(name)}: unknown;\n`;
	if (truncated) {
		body += `${pad}/** ${all.length - names.length} more properties not listed: ${sanitizeComment(all.slice(names.length).join(', '), 4000)} */\n`;
	}
	// Explicitly open objects keep an index signature; `unknown` stays compatible with every member
	if (open && (additional !== undefined || truncated || isObject(schema.patternProperties))) {
		body += `${pad}[key: string]: unknown;\n`;
	}
	return `{\n${body}${'\t'.repeat(ctx.indent)}}`;
}

/** Docs of a property: its own, plus those of an inlined `$ref` target it points to */
function memberDocs(property: Schema, name: string, ctx: Context): string[] {
	if (!isObject(property)) return [];
	const target = inlinedRefTarget(property, ctx);
	return schemaDocs(target ? mergeRefDocs(target, property) : property, { name });
}

/** The node's keywords win over its `$ref` target's, but both descriptions are kept */
function mergeRefDocs(target: Record<string, unknown>, node: Record<string, unknown>) {
	const merged = { ...target, ...withoutRef(node) };
	const own = typeof node.description === 'string' ? node.description.trim() : '';
	const inherited = typeof target.description === 'string' ? target.description.trim() : '';
	if (own && inherited && !own.includes(inherited)) merged.description = `${own}\n${inherited}`;
	return merged;
}

const withoutRef = (schema: Record<string, unknown>) => {
	const { $ref: _ref, ...rest } = schema;
	return rest;
};

/** The target of `$ref` when it is inlined (not aliased, not recursive), for its docs */
function inlinedRefTarget(schema: Record<string, unknown>, ctx: Context) {
	if (typeof schema.$ref !== 'string') return null;
	if (ctx.aliases?.isAliasedRef(ctx.rootId, schema.$ref)) return null;
	const target = resolveRef(ctx.root, schema.$ref);
	return isObject(target) ? target : null;
}

function emitArray(schema: Record<string, unknown>, ctx: Context): string {
	const inner = { ...ctx, depth: ctx.depth + 1 };
	const tuple = Array.isArray(schema.prefixItems)
		? schema.prefixItems
		: Array.isArray(schema.items)
			? schema.items
			: null;
	if (tuple) {
		const members = tuple.map((item) => emit(item as Schema, inner, 'inline'));
		const rest = Array.isArray(schema.items) ? schema.additionalItems : schema.items;
		if (rest === false) return `[${members.join(', ')}]`;
		const restType =
			rest === undefined || rest === true ? 'unknown' : emit(rest as Schema, inner, 'inline');
		return `[${[...members, `...${wrap(restType)}[]`].join(', ')}]`;
	}
	if (schema.items === undefined || schema.items === true) return 'unknown[]';
	return `${wrap(emit(schema.items as Schema, inner, 'inline'))}[]`;
}

function emitForType(type: string, schema: Record<string, unknown>, ctx: Context): string {
	switch (type) {
		case 'string':
			return 'string';
		case 'number':
		case 'integer':
			return 'number';
		case 'boolean':
			return 'boolean';
		case 'null':
			return 'null';
		case 'array':
			return emitArray(schema, ctx);
		case 'object':
			return emitObject(schema, ctx);
		default:
			return 'unknown';
	}
}

/** Structural keywords a parent shares with each `anyOf`/`oneOf` branch (never its docs) */
const SHARED_WITH_BRANCHES = [
	'type',
	'properties',
	'required',
	'additionalProperties',
	'patternProperties',
	'items',
	'prefixItems'
];

function emitRef(schema: Record<string, unknown>, ctx: Context, position: Position): string {
	const ref = schema.$ref as string;
	const target = ctx.refs.includes(ref) && !ctx.aliases ? undefined : resolveRef(ctx.root, ref);
	if (target === undefined) return withDoc('unknown', schema, position);
	const rest = withoutRef(schema);
	const hasSiblings = Object.keys(rest).some((key) => STRUCTURAL.has(key) && key !== '$defs');
	if (!ctx.aliases || typeof target === 'boolean' || hasSiblings) {
		if (ctx.refs.includes(ref)) return withDoc('unknown', schema, position);
		const merged = typeof target === 'boolean' ? target : mergeRefDocs(target, schema);
		return emit(merged, { ...ctx, refs: [...ctx.refs, ref] }, position);
	}
	const key = `${ctx.rootId} ${ref}`;
	const result = ctx.aliases.typeFor(
		key,
		ref,
		target,
		ctx.aliases.refCount(ctx.root, ref),
		ctx.ownerName,
		() => ({
			type: emit(target, { ...ctx, refs: [...ctx.refs, ref], indent: 1, depth: 0 }, 'member'),
			docs: schemaDocs(target)
		})
	);
	if (result.aliased) return withDoc(result.type, rest, position);
	// Inlined: re-emit at this indentation, with the target's docs merged under the node's
	return emit(mergeRefDocs(target, schema), { ...ctx, refs: [...ctx.refs, ref] }, position);
}

/** Adds the inline doc prefix of `schema` to `type` in inline positions */
function withDoc(type: string, schema: Schema, position: Position): string {
	if (position !== 'inline') return type;
	const prefix = inlineDoc(schemaDocs(schema));
	return prefix ? `${prefix}${type}` : type;
}

function emit(schema: Schema, ctx: Context, position: Position): string {
	if (schema === true) return 'unknown';
	if (schema === false) return 'never';
	if (!isObject(schema)) return 'unknown';
	if (ctx.depth > ctx.maxDepth) {
		const raw = position === 'inline' ? inlineDoc([`@schema ${jsonText(schema)}`]) : '';
		return `${raw}unknown`;
	}

	if (typeof schema.$ref === 'string') return emitRef(schema, ctx, position);

	let type: string;
	if ('const' in schema) {
		type = literal(schema.const) ?? 'unknown';
	} else if (Array.isArray(schema.enum)) {
		const members = schema.enum.map(literal);
		type =
			members.length === 0 || members.includes(null)
				? 'unknown'
				: uniqueJoin(members as string[], ' | ');
	} else if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
		const options = (schema.anyOf ?? schema.oneOf) as Schema[];
		const base: Record<string, unknown> = {};
		for (const key of SHARED_WITH_BRANCHES) if (key in schema) base[key] = schema[key];
		const hasBase = base.type !== undefined || base.properties !== undefined;
		type = uniqueJoin(
			options.map((option) =>
				emit(hasBase && isObject(option) ? { ...base, ...option } : option, ctx, 'inline')
			),
			' | '
		);
	} else if (Array.isArray(schema.allOf)) {
		const base: Record<string, unknown> = {};
		for (const key of SHARED_WITH_BRANCHES) if (key in schema) base[key] = schema[key];
		const parts = (schema.allOf as Schema[])
			.filter((part) => !typeless(part))
			.map((part) => emit(part, ctx, 'inline'));
		if (base.type !== undefined || base.properties !== undefined)
			parts.unshift(emit(base, ctx, 'inline'));
		type = uniqueJoin(
			parts.filter((part) => part !== 'unknown'),
			' & '
		);
		if (!type) type = 'unknown';
	} else if (Array.isArray(schema.type)) {
		type = uniqueJoin(
			schema.type.map((t) => (typeof t === 'string' ? emitForType(t, schema, ctx) : 'unknown')),
			' | '
		);
	} else if (typeof schema.type === 'string') {
		type = emitForType(schema.type, schema, ctx);
	} else if (isObject(schema.properties) || schema.additionalProperties !== undefined) {
		type = emitObject(schema, ctx);
	} else if (schema.items !== undefined || schema.prefixItems !== undefined) {
		type = emitArray(schema, ctx);
	} else {
		type = 'unknown';
	}

	if (schema.nullable === true && type !== 'unknown' && type !== 'null') {
		type = `${type} | null`;
	}
	return withDoc(type, schema, position);
}

/**
 * TypeScript type text for a JSON Schema. `indent` is the tab depth of the line the type
 * starts on (object members are indented one deeper). The root's own docs are not included:
 * get them with `schemaDocs`.
 */
export function schemaToType(schema: Schema, indent = 0, options: EmitOptions = {}): string {
	return emit(
		schema,
		{
			root: schema,
			rootId: options.rootId ?? 'root',
			ownerName: options.ownerName ?? '',
			depth: 0,
			indent,
			refs: [],
			maxDepth: options.maxDepth ?? 12,
			maxProperties: options.maxProperties ?? 200,
			aliases: options.aliases ?? null
		},
		'member'
	);
}

/** Whether an input schema accepts calling the tool with no arguments at all */
export function argsOptional(schema: Schema): boolean {
	if (!isObject(schema)) return true;
	const required = Array.isArray(schema.required) ? schema.required : [];
	return required.length === 0;
}
