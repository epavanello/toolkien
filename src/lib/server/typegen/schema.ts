/**
 * A small JSON Schema → TypeScript type emitter, written for tool schemas.
 *
 * Why not `json-schema-to-typescript`: it emits named `interface`s (global names that collide
 * across tools in one `.d.ts`), its output depends on `title`s chosen by the upstream, it is
 * async and heavy, and it copies descriptions verbatim into comments. Tool signatures need the
 * opposite: inline anonymous types, deterministic text, and every upstream string escaped
 * because it is untrusted (tool poisoning). The subset below covers what MCP servers publish
 * (`type`, `properties`, `required`, `items`/`prefixItems`, `enum`/`const`, `anyOf`/`oneOf`/
 * `allOf`, local `$ref`, `additionalProperties`, `nullable`); anything else degrades to
 * `unknown`, never to a wrong type.
 */

export type Schema = Record<string, unknown> | boolean;

export type EmitOptions = {
	/** Maximum nesting before falling back to `unknown` (default 8) */
	maxDepth?: number;
	/** Properties emitted per object before falling back to an index signature (default 200) */
	maxProperties?: number;
};

type Context = {
	root: Schema;
	depth: number;
	indent: number;
	refs: string[];
	maxDepth: number;
	maxProperties: number;
};

const MAX_COMMENT_LENGTH = 2000;

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Makes untrusted text safe inside a `/** … *\/` block: no comment terminator, no control
 * characters, and no line that starts with `@` (an upstream must not be able to fake our
 * `@readOnly` tags). Long text is cut with an ellipsis.
 */
export function sanitizeComment(text: string, maxLength = MAX_COMMENT_LENGTH): string {
	let clean = text
		.replace(/\r\n?/g, '\n')
		// eslint-disable-next-line no-control-regex -- stripping control characters on purpose
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, '')
		.replace(/\*\//g, '*\\/')
		.replace(/^(\s*)@/gm, '$1\\@')
		.trim();
	if (clean.length > maxLength) clean = `${clean.slice(0, maxLength).trimEnd()}…`;
	return clean;
}

/** A JSDoc block (or nothing) at `indent` tabs; `lines` may contain newlines */
export function jsDoc(lines: string[], indent: number): string {
	const body = lines.flatMap((line) => line.split('\n')).map((line) => line.trimEnd());
	while (body.length > 0 && body[body.length - 1] === '') body.pop();
	if (body.length === 0) return '';
	const pad = '\t'.repeat(indent);
	if (body.length === 1) return `${pad}/** ${body[0]} */\n`;
	return `${pad}/**\n${body.map((line) => `${pad} *${line ? ` ${line}` : ''}`).join('\n')}\n${pad} */\n`;
}

const literal = (value: unknown): string | null => {
	if (value === null) return 'null';
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'number';
	if (typeof value === 'boolean') return String(value);
	return null;
};

/** Whether `type` has a `|` or `&` outside brackets and string literals */
function hasTopLevelOperator(type: string): boolean {
	let depth = 0;
	let quote = false;
	for (let i = 0; i < type.length; i++) {
		const char = type[i];
		if (!quote && char === '/' && type[i + 1] === '*') {
			// JSDoc of object members: sanitized, so the first `*/` is its own terminator
			const end = type.indexOf('*/', i + 2);
			if (end === -1) return false;
			i = end + 1;
			continue;
		}
		if (quote) {
			if (char === '\\') i++;
			else if (char === '"') quote = false;
		} else if (char === '"') quote = true;
		else if (char === '{' || char === '[' || char === '(' || char === '<') depth++;
		else if (char === '}' || char === ']' || char === ')' || char === '>') depth--;
		else if (depth === 0 && (char === '|' || char === '&')) return true;
	}
	return false;
}

/** `a | b` members need parentheses inside `T[]`, unions of intersections and intersections */
const wrap = (type: string) => (hasTopLevelOperator(type) ? `(${type})` : type);

const uniqueJoin = (types: string[], separator: ' | ' | ' & ') => {
	const seen = [...new Set(types)];
	if (separator === ' | ' && seen.includes('unknown')) return 'unknown';
	return seen.length === 1 ? seen[0] : seen.map(wrap).join(separator);
};

function resolveRef(root: Schema, ref: string): Schema | undefined {
	if (ref === '#') return root;
	if (!ref.startsWith('#/')) return undefined;
	let node: unknown = root;
	for (const raw of ref.slice(2).split('/')) {
		const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
		if (!isObject(node)) return undefined;
		node = node[key];
	}
	return isObject(node) || typeof node === 'boolean' ? node : undefined;
}

function propertyKey(name: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** JSDoc lines describing a property: description, format, default */
function propertyDoc(schema: Schema): string[] {
	if (!isObject(schema)) return [];
	const lines: string[] = [];
	if (typeof schema.description === 'string' && schema.description.trim()) {
		lines.push(sanitizeComment(schema.description, 500));
	} else if (typeof schema.title === 'string' && schema.title.trim()) {
		lines.push(sanitizeComment(schema.title, 200));
	}
	if (typeof schema.format === 'string')
		lines.push(`Format: ${sanitizeComment(schema.format, 50)}`);
	if (schema.default !== undefined) {
		const value = JSON.stringify(schema.default);
		if (value !== undefined && value.length <= 120)
			lines.push(`@default ${sanitizeComment(value)}`);
	}
	return lines;
}

function emitObject(schema: Record<string, unknown>, ctx: Context): string {
	const properties = isObject(schema.properties) ? schema.properties : {};
	const required = new Set(
		Array.isArray(schema.required) ? schema.required.filter((r) => typeof r === 'string') : []
	);
	const names = Object.keys(properties).slice(0, ctx.maxProperties);
	const truncated = Object.keys(properties).length > names.length;
	const additional = schema.additionalProperties;
	const open =
		truncated ||
		additional === true ||
		isObject(additional) ||
		isObject(schema.patternProperties) ||
		(additional === undefined && names.length === 0);

	if (names.length === 0) {
		if (!open) return 'Record<string, never>';
		return isObject(additional) && !truncated
			? `Record<string, ${emit(additional, { ...ctx, depth: ctx.depth + 1 })}>`
			: 'Record<string, unknown>';
	}

	const inner = { ...ctx, depth: ctx.depth + 1, indent: ctx.indent + 1 };
	const pad = '\t'.repeat(ctx.indent + 1);
	let body = '';
	for (const name of names) {
		const property = properties[name] as Schema;
		body += jsDoc(propertyDoc(property), ctx.indent + 1);
		const optional = required.has(name) ? '' : '?';
		body += `${pad}${propertyKey(name)}${optional}: ${emit(property, inner)};\n`;
	}
	// Explicitly open objects keep an index signature; `unknown` stays compatible with every member
	if (open && (additional !== undefined || truncated || isObject(schema.patternProperties))) {
		body += `${pad}[key: string]: unknown;\n`;
	}
	return `{\n${body}${'\t'.repeat(ctx.indent)}}`;
}

function emitArray(schema: Record<string, unknown>, ctx: Context): string {
	const inner = { ...ctx, depth: ctx.depth + 1 };
	const tuple = Array.isArray(schema.prefixItems)
		? schema.prefixItems
		: Array.isArray(schema.items)
			? schema.items
			: null;
	if (tuple) {
		const members = tuple.map((item) => emit(item as Schema, inner));
		const rest = Array.isArray(schema.items) ? schema.additionalItems : schema.items;
		if (rest === false) return `[${members.join(', ')}]`;
		const restType = rest === undefined || rest === true ? 'unknown' : emit(rest as Schema, inner);
		return `[${[...members, `...${wrap(restType)}[]`].join(', ')}]`;
	}
	if (schema.items === undefined || schema.items === true) return 'unknown[]';
	return `${wrap(emit(schema.items as Schema, inner))}[]`;
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

function emit(schema: Schema, ctx: Context): string {
	if (schema === true) return 'unknown';
	if (schema === false) return 'never';
	if (!isObject(schema) || ctx.depth > ctx.maxDepth) return 'unknown';

	let type: string;

	if (typeof schema.$ref === 'string') {
		const ref = schema.$ref;
		const target = ctx.refs.includes(ref) ? undefined : resolveRef(ctx.root, ref);
		type = target === undefined ? 'unknown' : emit(target, { ...ctx, refs: [...ctx.refs, ref] });
	} else if ('const' in schema) {
		type = literal(schema.const) ?? 'unknown';
	} else if (Array.isArray(schema.enum)) {
		const members = schema.enum.map(literal);
		type =
			members.length === 0 || members.includes(null)
				? 'unknown'
				: uniqueJoin(members as string[], ' | ');
	} else if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) {
		const options = (schema.anyOf ?? schema.oneOf) as Schema[];
		const base: Record<string, unknown> = { ...schema, anyOf: undefined, oneOf: undefined };
		const hasBase = base.type !== undefined || base.properties !== undefined;
		type = uniqueJoin(
			options.map((option) =>
				emit(hasBase && isObject(option) ? { ...base, ...option } : option, ctx)
			),
			' | '
		);
	} else if (Array.isArray(schema.allOf)) {
		const base: Record<string, unknown> = { ...schema, allOf: undefined };
		const parts = (schema.allOf as Schema[]).map((part) => emit(part, ctx));
		if (base.type !== undefined || base.properties !== undefined) parts.unshift(emit(base, ctx));
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
		type = `${wrap(type)} | null`;
	}
	return type;
}

/**
 * TypeScript type text for a JSON Schema. `indent` is the tab depth of the line the type
 * starts on (object members are indented one deeper).
 */
export function schemaToType(schema: Schema, indent = 0, options: EmitOptions = {}): string {
	return emit(schema, {
		root: schema,
		depth: 0,
		indent,
		refs: [],
		maxDepth: options.maxDepth ?? 8,
		maxProperties: options.maxProperties ?? 200
	});
}

/** Whether an input schema accepts calling the tool with no arguments at all */
export function argsOptional(schema: Schema): boolean {
	if (!isObject(schema)) return true;
	const required = Array.isArray(schema.required) ? schema.required : [];
	return required.length === 0;
}
