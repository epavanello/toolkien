import { createHash } from 'node:crypto';
import type { Sealed } from '#lib/server/crypto/types.ts';

/**
 * Helpers for content that crosses the bridge (tool arguments and results). Content is only ever
 * kept sealed; these helpers produce what is sealed (hashes, previews) and convert the
 * `sealed(prefix)` columns. Nothing here logs.
 */

/** JSON with object keys sorted, so equal arguments always hash the same */
export function stableStringify(value: unknown): string {
	if (value === undefined) return 'null';
	if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

/**
 * SHA-256 of the canonical arguments. Binds an approval and a cached result to the exact call:
 * a re-run that passes different arguments at the same `seq` never reuses them. Stored only
 * inside sealed payloads (low-entropy arguments could be guessed from a bare hash).
 */
export const hashArgs = (args: unknown) =>
	createHash('sha256').update(stableStringify(args)).digest('hex');

export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const MAX_VALUE_CHARS = 300;
const MAX_PREVIEW_CHARS = 4000;
const MAX_KEYS = 20;

const clip = (text: string, max: number) =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

/**
 * Human-readable preview of the main arguments for the approver: one `key: value` line per
 * top-level field, long values clipped. It is content: sealed at rest, shown only to the human.
 */
export function argumentsPreview(args: unknown): string {
	if (args === undefined || args === null) return '(no arguments)';
	if (typeof args !== 'object' || Array.isArray(args)) {
		return clip(stableStringify(args), MAX_PREVIEW_CHARS);
	}
	const entries = Object.entries(args as Record<string, unknown>).filter(
		([, v]) => v !== undefined
	);
	if (entries.length === 0) return '(no arguments)';
	const lines = entries.slice(0, MAX_KEYS).map(([key, value]) => {
		const text = typeof value === 'string' ? value : stableStringify(value);
		return `${key}: ${clip(text.replace(/\s+/g, ' '), MAX_VALUE_CHARS)}`;
	});
	if (entries.length > MAX_KEYS) lines.push(`… ${entries.length - MAX_KEYS} more fields`);
	return clip(lines.join('\n'), MAX_PREVIEW_CHARS);
}

/**
 * Value of a result from a tool without an output schema (`ToolCallResponse.text`): every content
 * block as the server sent it, plus `structuredContent` if it sent one anyway. Nothing is parsed
 * or dropped here; the sandbox prelude wraps it as `ToolTextResult` (`text`, `content`, `json()`).
 */
export type TextResultValue = { content: unknown[]; structuredContent?: unknown };

export const textResultValue = (result: {
	content: unknown[];
	structuredContent?: unknown;
}): TextResultValue =>
	result.structuredContent === undefined
		? { content: result.content }
		: { content: result.content, structuredContent: result.structuredContent };

/** Sealed payload of `approval.preview_*` (`text` is dropped once decided) */
export type SealedPreview = { argsHash: string; text?: string };

type SealedColumns = {
	ciphertext: Buffer | Uint8Array | null;
	nonce: Buffer | Uint8Array | null;
	keyVersion: number | null;
};

/** Column values → `Sealed`, or `null` when wiped */
export const readSealed = (columns: SealedColumns): Sealed | null =>
	columns.ciphertext && columns.nonce && columns.keyVersion !== null
		? { ciphertext: columns.ciphertext, nonce: columns.nonce, keyVersion: columns.keyVersion }
		: null;

/** `Sealed` → the three column values (`null` wipes) */
export const writeSealed = (sealed: Sealed | null) => ({
	ciphertext: sealed ? Buffer.from(sealed.ciphertext) : null,
	nonce: sealed ? Buffer.from(sealed.nonce) : null,
	keyVersion: sealed ? sealed.keyVersion : null
});
