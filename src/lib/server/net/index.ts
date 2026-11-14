import { dev } from '$app/env';
import { EGRESS_PROXY_URL } from '$app/env/private';
import { createSafeFetch } from './fetch.ts';
import { assertSafeUrlWith, type UrlPolicy } from './policy.ts';
import type { AssertSafeUrl, SafeFetch } from './types.ts';

export { UnsafeUrlError } from './types.ts';
export type { AssertSafeUrl, SafeFetch, SafeFetchOptions, UnsafeUrlReason } from './types.ts';
export { isAllowedAddress } from './ip.ts';

/** Development may reach loopback (local MCP servers); production never does */
const policy: UrlPolicy = { allowLoopback: dev };

export const assertSafeUrl: AssertSafeUrl = (url) => assertSafeUrlWith(url, policy);

let instance: SafeFetch | undefined;
let warned = false;

/** Lazy so the build never opens sockets; one shared connection pool per process */
export const safeFetch: SafeFetch = (input, init) => {
	if (!dev && !EGRESS_PROXY_URL && !warned) {
		warned = true;
		console.warn(
			'[net] EGRESS_PROXY_URL is not set: upstream calls leave without the egress proxy'
		);
	}
	instance ??= createSafeFetch({ ...policy, proxyUrl: EGRESS_PROXY_URL });
	return instance(input, init);
};
