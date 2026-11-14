import {
	discoverOAuthServerInfo,
	extractWWWAuthenticateParams,
	type FetchLike
} from '@modelcontextprotocol/client';
import { safeFetch } from '#lib/server/net/index.ts';
import type { ConnectorAuthType } from './types.ts';

/**
 * Authentication detection for a remote MCP server, before anything is stored: one
 * unauthenticated `ping` through `net.safeFetch`, then OAuth discovery when it is challenged.
 *
 * - 401 (or 403 with a challenge) + discoverable OAuth metadata (the RFC 9728
 *   `resource_metadata` of the `WWW-Authenticate` challenge first, then the well-known paths)
 *   ⇒ `oauth`
 * - 401 without OAuth metadata ⇒ `token` (the server wants a bearer token / API key)
 * - any other answer ⇒ `oauth` when the server still publishes protected resource metadata at
 *   the well-known path, else the fallback (`none`, or `token` when the directory says so)
 * - timeout / network failure ⇒ the fallback, with a note for the user
 *
 * Bounded by one deadline (default 6 s). Bodies are discarded unread; nothing is logged.
 */

export const DETECT_TIMEOUT_MS = 6_000;

export type AuthDetection = {
	authType: ConnectorAuthType;
	/** What decided it (diagnostics and tests; no upstream content) */
	via: 'challenge' | 'metadata' | 'unauthorized' | 'open' | 'timeout' | 'unreachable';
	/** User-facing note when the detection was inconclusive */
	note: string | null;
};

const TIMEOUT_NOTE =
	'The server did not answer in time, so its authentication could not be detected. Toolkien will check again on the first sync.';
const UNREACHABLE_NOTE =
	'The server could not be reached, so its authentication could not be detected. Toolkien will check again on the first sync.';

type Fallback = Exclude<ConnectorAuthType, 'oauth'>;

export async function detectAuth(
	url: string,
	opts: { fallback?: Fallback; timeoutMs?: number } = {}
): Promise<AuthDetection> {
	const fallback = opts.fallback ?? 'none';
	const timeoutMs = opts.timeoutMs ?? DETECT_TIMEOUT_MS;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const deadline = new Promise<AuthDetection>((resolve) =>
		controller.signal.addEventListener(
			'abort',
			() => resolve({ authType: fallback, via: 'timeout', note: TIMEOUT_NOTE }),
			{ once: true }
		)
	);
	try {
		return await Promise.race([probe(url, fallback, controller.signal, timeoutMs), deadline]);
	} finally {
		clearTimeout(timer);
		controller.abort();
	}
}

async function probe(
	url: string,
	fallback: Fallback,
	signal: AbortSignal,
	timeoutMs: number
): Promise<AuthDetection> {
	const fetchFn: FetchLike = (input, init) =>
		safeFetch(String(input instanceof URL ? input.href : input), {
			...init,
			signal,
			timeoutMs,
			maxRedirects: 2,
			maxResponseBytes: 256 * 1024
		});

	let response: Response;
	try {
		response = await fetchFn(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' })
		});
	} catch (cause) {
		const timedOut =
			signal.aborted || (cause instanceof Error && /timeout|abort/i.test(cause.message));
		return timedOut
			? { authType: fallback, via: 'timeout', note: TIMEOUT_NOTE }
			: { authType: fallback, via: 'unreachable', note: UNREACHABLE_NOTE };
	}
	const challenged =
		response.status === 401 ||
		(response.status === 403 && response.headers.has('www-authenticate'));
	const { resourceMetadataUrl } = challenged ? extractWWWAuthenticateParams(response) : {};
	await response.body?.cancel().catch(() => undefined);

	if (challenged) {
		if (await hasOAuthMetadata(url, fetchFn, { resourceMetadataUrl, requireResource: false })) {
			return { authType: 'oauth', via: resourceMetadataUrl ? 'challenge' : 'metadata', note: null };
		}
		return { authType: 'token', via: 'unauthorized', note: null };
	}
	// Open answer: OAuth only when the server still advertises a protected resource
	if (await hasOAuthMetadata(url, fetchFn, { requireResource: true })) {
		return { authType: 'oauth', via: 'metadata', note: null };
	}
	return { authType: fallback, via: 'open', note: null };
}

async function hasOAuthMetadata(
	url: string,
	fetchFn: FetchLike,
	opts: { resourceMetadataUrl?: URL; requireResource: boolean }
) {
	try {
		const info = await discoverOAuthServerInfo(url, {
			resourceMetadataUrl: opts.resourceMetadataUrl,
			fetchFn
		});
		return !!info.authorizationServerMetadata && (!opts.requireResource || !!info.resourceMetadata);
	} catch {
		return false;
	}
}

/** `resource_metadata` and `scope` of the server's unauthenticated challenge (best effort) */
export async function readChallenge(
	url: string,
	timeoutMs = DETECT_TIMEOUT_MS
): Promise<{ resourceMetadataUrl?: URL; scope?: string }> {
	try {
		const response = await safeFetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
			timeoutMs
		});
		const params = response.status === 401 ? extractWWWAuthenticateParams(response) : {};
		await response.body?.cancel().catch(() => undefined);
		return { resourceMetadataUrl: params.resourceMetadataUrl, scope: params.scope };
	} catch {
		return {};
	}
}
