import {
	Client,
	StreamableHTTPClientTransport,
	type FetchLike,
	type ListChangedHandlers,
	type Tool
} from '@modelcontextprotocol/client';
import { safeFetch, UnsafeUrlError } from '#lib/server/net/index.ts';
import type { JsonSchema, ToolAnnotations, UpstreamCallResult } from './types.ts';

/**
 * Upstream MCP client: Streamable HTTP through `net.safeFetch` (SSRF rules, egress proxy), with
 * protocol version negotiation (`server/discover` for 2026-07-28, falling back to the 2025
 * `initialize` handshake). One short-lived connection per operation: the 2026-07-28 transport
 * is stateless and credentials are decrypted only for the duration of the call.
 *
 * Never logs or returns tokens, arguments, results or upstream bodies in errors.
 */

export const CLIENT_INFO = { name: 'toolkien', version: '1.0.0' } as const;

/** Sync (`tools/list`) and connect budget; tool calls get their own, longer one */
export const LIST_TIMEOUT_MS = 30_000;
export const CALL_TIMEOUT_MS = 120_000;

export type UpstreamCredential = { token: string } | null;

export type UpstreamTool = {
	name: string;
	title: string | null;
	description: string | null;
	inputSchema: JsonSchema;
	outputSchema: JsonSchema | null;
	annotations: ToolAnnotations | null;
};

export type SessionInfo = {
	protocolVersion: string | null;
	serverInfo: { name: string; version: string } | null;
	toolsListChanged: boolean;
};

/** Typed failure of an upstream operation; `message` is safe to show (no upstream content) */
export class UpstreamError extends Error {
	constructor(
		readonly code: 'auth_required' | 'unreachable' | 'blocked' | 'timeout' | 'protocol',
		message: string
	) {
		super(message);
		this.name = 'UpstreamError';
	}
}

type FetchState = { status401: boolean };

/**
 * `fetch` for the SDK: `safeFetch`, the bearer token only towards the connector's own origin
 * (never to the authorization server or a redirect target), no redirects.
 */
export function upstreamFetch(
	connectorUrl: string,
	credential: UpstreamCredential,
	timeoutMs: number,
	state: FetchState = { status401: false }
): FetchLike {
	const origin = new URL(connectorUrl).origin;
	return async (input, init) => {
		const url = new URL(String(input instanceof URL ? input.href : input));
		const headers = new Headers(init?.headers);
		if (credential && url.origin === origin)
			headers.set('authorization', `Bearer ${credential.token}`);
		else headers.delete('authorization');
		const response = await safeFetch(url, { ...init, headers, timeoutMs, maxRedirects: 0 });
		if (response.status === 401 && url.origin === origin) state.status401 = true;
		return response;
	};
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function pickAnnotations(value: unknown): ToolAnnotations | null {
	if (!isRecord(value)) return null;
	const result: ToolAnnotations = {};
	if (typeof value.title === 'string') result.title = value.title;
	for (const key of [
		'readOnlyHint',
		'destructiveHint',
		'idempotentHint',
		'openWorldHint'
	] as const) {
		if (typeof value[key] === 'boolean') result[key] = value[key];
	}
	return Object.keys(result).length > 0 ? result : null;
}

export function toUpstreamTool(tool: Tool): UpstreamTool {
	return {
		name: tool.name,
		title: typeof tool.title === 'string' ? tool.title : null,
		description: typeof tool.description === 'string' ? tool.description : null,
		inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : { type: 'object' },
		outputSchema: isRecord(tool.outputSchema) ? tool.outputSchema : null,
		annotations: pickAnnotations(tool.annotations)
	};
}

function mapError(error: unknown, state: FetchState): UpstreamError {
	if (error instanceof UpstreamError) return error;
	if (state.status401) {
		return new UpstreamError('auth_required', 'The server rejected the credentials (401).');
	}
	if (error instanceof UnsafeUrlError) {
		return error.reason === 'timeout'
			? new UpstreamError('timeout', 'The server did not answer in time.')
			: new UpstreamError('blocked', `Outbound request blocked (${error.reason}).`);
	}
	const name = error instanceof Error ? error.name : '';
	const text = error instanceof Error ? error.message : '';
	if (/timeout|timed out|abort/i.test(`${name} ${text}`)) {
		return new UpstreamError('timeout', 'The server did not answer in time.');
	}
	if (/unauthor/i.test(name)) {
		return new UpstreamError('auth_required', 'The server requires authentication.');
	}
	return new UpstreamError('unreachable', 'Could not talk to the MCP server.');
}

export type SessionOptions = {
	url: string;
	credential: UpstreamCredential;
	timeoutMs?: number;
	/** Called when the server announces `notifications/tools/list_changed` */
	onToolsChanged?: () => void;
};

/** Opens a connection, runs `fn`, closes. Connection-level failures become `UpstreamError` */
export async function withSession<T>(
	options: SessionOptions,
	fn: (client: Client) => Promise<T>
): Promise<{ value: T; info: SessionInfo }> {
	const state: FetchState = { status401: false };
	const timeoutMs = options.timeoutMs ?? LIST_TIMEOUT_MS;
	const client = new Client(CLIENT_INFO, {
		versionNegotiation: { mode: 'auto' },
		capabilities: {}
	});
	if (options.onToolsChanged) {
		const notify = options.onToolsChanged;
		client.setNotificationHandler('notifications/tools/list_changed', () => notify());
	}
	const transport = new StreamableHTTPClientTransport(new URL(options.url), {
		fetch: upstreamFetch(options.url, options.credential, timeoutMs, state)
	});
	try {
		try {
			await client.connect(transport, { timeout: timeoutMs });
		} catch (error) {
			throw mapError(error, state);
		}
		const info: SessionInfo = {
			protocolVersion: client.getNegotiatedProtocolVersion() ?? null,
			serverInfo: (() => {
				const server = client.getServerVersion();
				return server ? { name: server.name, version: server.version } : null;
			})(),
			toolsListChanged: client.getServerCapabilities()?.tools?.listChanged === true
		};
		try {
			return { value: await fn(client), info };
		} catch (error) {
			if (state.status401) throw mapError(error, state);
			throw error;
		}
	} finally {
		await client.close().catch(() => undefined);
	}
}

export async function listTools(
	options: SessionOptions
): Promise<{ tools: UpstreamTool[]; info: SessionInfo }> {
	const { value, info } = await withSession(options, async (client) => {
		try {
			const result = await client.listTools(undefined, {
				timeout: options.timeoutMs ?? LIST_TIMEOUT_MS,
				cacheMode: 'bypass'
			});
			return result.tools.map(toUpstreamTool);
		} catch (error) {
			throw mapError(error, { status401: false });
		}
	});
	return { tools: value, info };
}

const textOf = (content: unknown[]): string =>
	content
		.map((block) =>
			isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? block.text : ''
		)
		.filter(Boolean)
		.join('\n');

const INVALID_ARGS =
	/invalid (argument|param|input)|validation (error|failed)|required (property|parameter)|must have required|unexpected (property|argument)/i;
const UNKNOWN_TOOL = /unknown tool|tool .*not found|no such tool|tool not found/i;

/** Error text for the agent: upstream text is the tool's own answer, capped */
const cap = (text: string) => (text.length > 2000 ? `${text.slice(0, 2000)}…` : text);

/**
 * Calls one tool. Tool-level errors (`isError`) come back as `upstream_error` with the tool's
 * own text (it is the result the script asked for, shown to the agent, never logged);
 * protocol errors become `unknown_tool` / `invalid_params` so the caller refreshes.
 */
export async function callUpstreamTool(
	options: SessionOptions,
	tool: { name: string; inputSchema: JsonSchema; outputSchema: JsonSchema | null },
	args: unknown
): Promise<UpstreamCallResult> {
	try {
		const { value } = await withSession(
			{ ...options, timeoutMs: options.timeoutMs ?? CALL_TIMEOUT_MS },
			async (client) => {
				try {
					const definition = {
						name: tool.name,
						inputSchema: tool.inputSchema,
						...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {})
					} as Tool;
					const result = await client.callTool(
						{ name: tool.name, arguments: isRecord(args) ? args : {} },
						{ timeout: options.timeoutMs ?? CALL_TIMEOUT_MS, toolDefinition: definition }
					);
					const content = Array.isArray(result.content) ? (result.content as unknown[]) : [];
					if (result.isError) {
						const text = textOf(content);
						return {
							ok: false as const,
							code: INVALID_ARGS.test(text)
								? ('invalid_params' as const)
								: ('upstream_error' as const),
							message: cap(text || 'The tool reported an error.')
						};
					}
					return {
						ok: true as const,
						content,
						...(result.structuredContent !== undefined
							? { structuredContent: result.structuredContent }
							: {})
					};
				} catch (error) {
					const code = isRecord(error) && typeof error.code === 'number' ? error.code : null;
					const message = error instanceof Error ? error.message : '';
					if (code === -32602 || code === -32601) {
						return {
							ok: false as const,
							code:
								UNKNOWN_TOOL.test(message) || code === -32601
									? ('unknown_tool' as const)
									: ('invalid_params' as const),
							message:
								UNKNOWN_TOOL.test(message) || code === -32601
									? `Unknown tool "${tool.name}" on the server.`
									: 'The server rejected the arguments.'
						};
					}
					throw error;
				}
			}
		);
		return value;
	} catch (error) {
		const mapped = mapError(error, { status401: false });
		if (mapped.code === 'auth_required')
			return { ok: false, code: 'auth_required', message: mapped.message };
		if (mapped.code === 'timeout') return { ok: false, code: 'timeout', message: mapped.message };
		return { ok: false, code: 'upstream_error', message: mapped.message };
	}
}

/**
 * The value a script receives for a successful call: `structuredContent` when the server sent
 * it, else the single text block parsed as JSON when possible, else the text, else the
 * content blocks. Shared by the bridge so `.d.ts` return types and runtime values agree.
 */
export function toScriptValue(result: Extract<UpstreamCallResult, { ok: true }>): unknown {
	if (result.structuredContent !== undefined) return result.structuredContent;
	const blocks = result.content;
	if (blocks.length === 1 && isRecord(blocks[0]) && blocks[0].type === 'text') {
		const text = String(blocks[0].text ?? '');
		try {
			return JSON.parse(text);
		} catch {
			return text;
		}
	}
	return blocks;
}

/** Long-lived listener for `tools/list_changed` (see `watch.ts`) */
export async function openToolsWatch(
	options: Omit<SessionOptions, 'onToolsChanged'> & { onChanged: () => void }
): Promise<{ close: () => Promise<void>; closed: Promise<unknown> }> {
	const listChanged: ListChangedHandlers = {
		tools: { autoRefresh: false, debounceMs: 500, onChanged: () => options.onChanged() }
	};
	const client = new Client(CLIENT_INFO, {
		versionNegotiation: { mode: 'auto' },
		capabilities: {},
		listChanged
	});
	const state: FetchState = { status401: false };
	// No timeout on the stream itself: the watcher closes it on idle
	const transport = new StreamableHTTPClientTransport(new URL(options.url), {
		fetch: upstreamFetch(options.url, options.credential, 24 * 60 * 60 * 1000, state)
	});
	try {
		await client.connect(transport, { timeout: LIST_TIMEOUT_MS });
	} catch (error) {
		await client.close().catch(() => undefined);
		throw mapError(error, state);
	}
	const closed = new Promise((resolve) => {
		client.onclose = () => resolve('closed');
	});
	return { close: () => client.close().catch(() => undefined), closed };
}
