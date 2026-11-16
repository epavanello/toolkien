/**
 * The MCP `clientInfo` (implementation name and version) of a request, for the activity log.
 *
 * - 2026-07-28 requests carry it in every request's `_meta` envelope
 *   (`io.modelcontextprotocol/clientInfo`).
 * - 2025-11-25 clients send it once, in `initialize`; we serve them statelessly, so the endpoint
 *   remembers it per user and OAuth client and labels their later requests with it.
 *
 * It is self-asserted by the client, like the OAuth `client_name`: display only, never used for
 * a security decision. Values are sanitized (no control characters) and length-capped.
 */
import { CLIENT_INFO_META_KEY } from '@modelcontextprotocol/server';

const PART_MAX = 60;

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/** Printable, single-line, capped; `null` when nothing is left */
export function cleanPart(value: unknown, max = PART_MAX): string | null {
	if (typeof value !== 'string') return null;
	// eslint-disable-next-line no-control-regex
	const text = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ');
	const line = text.replace(/\s+/g, ' ').trim();
	if (!line) return null;
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** `name version` from an MCP `Implementation` object (`{ name, version, title? }`) */
export function formatClientInfo(value: unknown): string | null {
	if (!isObject(value)) return null;
	const name = cleanPart(value.name);
	if (!name) return null;
	const version = cleanPart(value.version, 30);
	return version ? `${name} ${version}` : name;
}

export type PeekedClientInfo = {
	/** `name version`, or `null` when the request carries none */
	info: string | null;
	/** It came from `initialize` (2025-era handshake): worth remembering for later requests */
	fromInitialize: boolean;
};

const NONE: PeekedClientInfo = { info: null, fromInitialize: false };

/**
 * Reads the client info of a JSON-RPC request body without consuming the request (a clone is
 * parsed). Anything unexpected (batch, not JSON, too large) yields nothing.
 */
export async function peekClientInfo(
	request: Request,
	maxBytes = 1_000_000
): Promise<PeekedClientInfo> {
	if (!request.headers.get('content-type')?.includes('json')) return NONE;
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > maxBytes) return NONE;
	try {
		const text = await request.clone().text();
		if (text.length > maxBytes) return NONE;
		const message: unknown = JSON.parse(text);
		if (!isObject(message) || !isObject(message.params)) return NONE;
		const params = message.params;
		const meta = isObject(params._meta) ? params._meta : undefined;
		const fromEnvelope = formatClientInfo(meta?.[CLIENT_INFO_META_KEY]);
		if (fromEnvelope) return { info: fromEnvelope, fromInitialize: false };
		if (message.method === 'initialize') {
			const info = formatClientInfo(params.clientInfo);
			return info ? { info, fromInitialize: true } : NONE;
		}
		return NONE;
	} catch {
		return NONE;
	}
}
