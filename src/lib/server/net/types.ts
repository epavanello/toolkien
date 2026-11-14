/**
 * Outbound network contract (owner: infra). Every request to a URL that did not come from our
 * own config (upstream MCP servers, upstream OAuth endpoints, CIMD documents) goes through
 * `safeFetch`, which goes through `EGRESS_PROXY_URL` when set.
 *
 * SSRF rules:
 * - `https:` only (plain `http:` only to loopback, in development).
 * - Reject private, loopback, link-local, CGNAT, multicast, reserved, cloud metadata
 *   (169.254.169.254, fd00:ec2::254…), IPv4-mapped/NAT64/6to4 IPv6 forms and the Docker
 *   networks of the deploy.
 * - Resolve DNS once, check every address, and connect to the checked address (no second
 *   lookup: DNS rebinding).
 * - Redirects are followed manually (at most `maxRedirects`), each hop re-checked.
 * - Bounded time and response size.
 */

export type UnsafeUrlReason =
	| 'invalid_url'
	| 'scheme'
	| 'credentials_in_url'
	| 'blocked_address'
	| 'dns_failure'
	| 'too_many_redirects'
	| 'response_too_large'
	| 'timeout';

export class UnsafeUrlError extends Error {
	constructor(
		readonly reason: UnsafeUrlReason,
		message = `Blocked outbound request (${reason})`
	) {
		super(message);
		this.name = 'UnsafeUrlError';
	}
}

export type SafeFetchOptions = {
	/** Default 0: redirects are refused unless the caller opts in */
	maxRedirects?: number;
	/** Default 15 000 ms */
	timeoutMs?: number;
	/** Default 5 MiB; the body stream errors past it */
	maxResponseBytes?: number;
};

/** Validates syntax, scheme and resolved addresses; returns the normalised URL */
export type AssertSafeUrl = (url: string | URL) => Promise<URL>;

/** `fetch` with the SSRF rules above; throws `UnsafeUrlError` when a rule is violated */
export type SafeFetch = (
	input: string | URL,
	init?: RequestInit & SafeFetchOptions
) => Promise<Response>;
