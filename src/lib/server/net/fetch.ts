import { Agent, ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici';
import { UnsafeUrlError, type SafeFetch } from './types.ts';
import {
	assertSafeUrlWith,
	createPinnedLookup,
	validateUrlShape,
	type UrlPolicy
} from './policy.ts';

export type SafeFetchConfig = UrlPolicy & {
	/** `http://user:token@egress-proxy:3128`; when set every request is tunnelled through it */
	proxyUrl?: string;
	/** Override the dispatcher (tests) */
	dispatcher?: Dispatcher;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Headers that must not follow a redirect to another origin */
const CREDENTIAL_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

function createDispatcher(config: SafeFetchConfig): Dispatcher {
	if (config.dispatcher) return config.dispatcher;
	if (config.proxyUrl) {
		// The proxy resolves, re-checks and pins the address itself (it is the enforcement point);
		// TLS is end to end through the CONNECT tunnel, so the proxy never sees payloads.
		return new ProxyAgent({ uri: config.proxyUrl, proxyTunnel: true, connectTimeout: 10_000 });
	}
	return new Agent({
		connect: { lookup: createPinnedLookup(config), timeout: 10_000 },
		// Never reuse a connection longer than a DNS answer would reasonably live
		keepAliveTimeout: 10_000,
		keepAliveMaxTimeout: 60_000
	});
}

/** Finds the `UnsafeUrlError` that undici wraps in `TypeError('fetch failed')` */
function unwrap(error: unknown, signal: AbortSignal, timeout: AbortSignal): unknown {
	let current: unknown = error;
	for (let depth = 0; current && depth < 5; depth++) {
		if (current instanceof UnsafeUrlError) return current;
		// The egress proxy answers 403 for blocked destinations
		const message = current instanceof Error ? current.message : '';
		if (/Proxy response \(403\)/.test(message)) return new UnsafeUrlError('blocked_address');
		current = (current as { cause?: unknown }).cause;
	}
	if (timeout.aborted && !signal.aborted) return new UnsafeUrlError('timeout');
	return error;
}

/** Errors the body stream once more than `max` bytes have been read */
function limitBody(body: ReadableStream<Uint8Array>, max: number): ReadableStream<Uint8Array> {
	let seen = 0;
	return body.pipeThrough(
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				seen += chunk.byteLength;
				if (seen > max) controller.error(new UnsafeUrlError('response_too_large'));
				else controller.enqueue(chunk);
			}
		})
	);
}

function replayableBody(body: RequestInit['body']) {
	return (
		body == null ||
		typeof body === 'string' ||
		body instanceof URLSearchParams ||
		body instanceof ArrayBuffer ||
		ArrayBuffer.isView(body)
	);
}

export function createSafeFetch(config: SafeFetchConfig = {}): SafeFetch {
	const dispatcher = createDispatcher(config);

	return async (input, init = {}) => {
		const {
			maxRedirects = 0,
			timeoutMs = DEFAULT_TIMEOUT_MS,
			maxResponseBytes = DEFAULT_MAX_BYTES,
			signal: callerSignal,
			...requestInit
		} = init;

		const timeout = AbortSignal.timeout(timeoutMs);
		const callerAbort = callerSignal ?? new AbortController().signal;
		const signal = AbortSignal.any([timeout, callerAbort]);

		let url = validateUrlShape(input, config);
		let method = (requestInit.method ?? 'GET').toUpperCase();
		let body = requestInit.body;
		const headers = new Headers(requestInit.headers);
		if (maxRedirects > 0 && !replayableBody(body)) {
			throw new TypeError('safeFetch: redirects need a replayable body (string or bytes)');
		}

		for (let hop = 0; ; hop++) {
			// Through the proxy the app does not connect itself: check here so callers get a precise
			// reason, the proxy checks again on the address it actually dials.
			// Direct: the pinned `lookup` checks the address at connect time, nothing to do here.
			if (config.proxyUrl) await assertSafeUrlWith(url, config);

			let response;
			try {
				response = await undiciFetch(url, {
					...(requestInit as object),
					method,
					headers,
					body: body as never,
					redirect: 'manual',
					signal,
					dispatcher
				});
			} catch (error) {
				throw unwrap(error, callerAbort, timeout);
			}

			if (REDIRECT_STATUSES.has(response.status) && response.headers.has('location')) {
				await response.body?.cancel();
				if (hop >= maxRedirects) throw new UnsafeUrlError('too_many_redirects');
				const next = validateUrlShape(new URL(response.headers.get('location')!, url), config);
				if (next.origin !== url.origin) {
					for (const name of CREDENTIAL_HEADERS) headers.delete(name);
				}
				if (
					response.status === 303 ||
					([301, 302].includes(response.status) && method === 'POST')
				) {
					method = method === 'HEAD' ? 'HEAD' : 'GET';
					body = undefined;
					headers.delete('content-type');
					headers.delete('content-length');
				}
				url = next;
				continue;
			}

			const declared = Number(response.headers.get('content-length') ?? '0');
			if (declared > maxResponseBytes) {
				await response.body?.cancel();
				throw new UnsafeUrlError('response_too_large');
			}
			const limited = response.body
				? limitBody(response.body as ReadableStream<Uint8Array>, maxResponseBytes)
				: null;
			const result = new Response(limited, {
				status: response.status,
				statusText: response.statusText,
				headers: response.headers as unknown as Headers
			});
			Object.defineProperty(result, 'url', { value: url.href });
			return result;
		}
	};
}
