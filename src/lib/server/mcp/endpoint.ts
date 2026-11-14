/**
 * The `/mcp` HTTP pipeline, in order:
 * 1. POST only (stateless server: GET/DELETE and the rest answer 405).
 * 2. Origin validation (DNS rebinding): a browser `Origin` must be ours.
 * 3. Rate limit per IP, before any token work.
 * 4. Bearer token: signature, issuer, expiry, `aud = ${ORIGIN}/mcp` (Better Auth
 *    `requireMcpAuth`); failures get the RFC 9728 `WWW-Authenticate` challenge.
 * 5. Kill switches: disabled OAuth client, suspended user (`limits.assertNotSuspended`).
 * 6. Rate limit per user.
 * 7. The MCP handler, with the client name captured for audit.
 *
 * Cookies are never read here (the hooks skip sessions on `/mcp`).
 */
import { isHttpError } from '@sveltejs/kit';
import type { LimitsService } from '#lib/server/limits/types.ts';
import type { HandleMcpRequest, McpRequestContext } from './types.ts';

/** Verified claims of the access token (subset of the JWT payload) */
export type AccessTokenClaims = { sub?: unknown; azp?: unknown; scope?: unknown };

export type McpEndpointDeps = {
	handle: HandleMcpRequest;
	/** Verifies the bearer token, then calls `next`; otherwise answers the OAuth challenge */
	verify: (
		request: Request,
		next: (request: Request, claims: AccessTokenClaims) => Promise<Response>
	) => Promise<Response>;
	loadClient: (clientId: string) => Promise<{ name: string | null; disabled: boolean } | null>;
	loadUser: (userId: string) => Promise<{ suspended: boolean } | null>;
	limits: Pick<LimitsService, 'checkRateLimit' | 'assertNotSuspended' | 'getLimits'>;
	/** Exact origins a browser may call `/mcp` from (requests without `Origin` are allowed) */
	isAllowedOrigin: (origin: string) => boolean;
};

const WINDOW_MS = 60_000;
/** Generous: an agent session makes a burst of search/describe calls around each script */
export const MCP_REQUESTS_PER_MIN_PER_IP = 600;
export const minRequestsPerUser = (execPerMin: number) => Math.max(300, execPerMin * 5);

export function jsonRpcError(
	status: number,
	message: string,
	headers: Record<string, string> = {}
): Response {
	return new Response(
		JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }),
		{ status, headers: { 'Content-Type': 'application/json', ...headers } }
	);
}

export const methodNotAllowed = () =>
	new Response(null, { status: 405, headers: { Allow: 'POST' } });

function rateLimited(retryAfterMs: number) {
	return jsonRpcError(429, 'Too many requests. Slow down and retry shortly.', {
		'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1000)))
	});
}

export function createMcpEndpoint(deps: McpEndpointDeps) {
	return async (request: Request, meta: { clientAddress: string }): Promise<Response> => {
		if (request.method !== 'POST') return methodNotAllowed();

		const origin = request.headers.get('origin');
		if (origin && !deps.isAllowedOrigin(origin)) {
			return jsonRpcError(403, 'Origin not allowed.');
		}

		const byIp = deps.limits.checkRateLimit(
			`mcp:ip:${meta.clientAddress}`,
			MCP_REQUESTS_PER_MIN_PER_IP,
			WINDOW_MS
		);
		if (!byIp.allowed) return rateLimited(byIp.retryAfterMs);

		return deps.verify(request, async (verified, claims) => {
			const userId = typeof claims.sub === 'string' ? claims.sub : null;
			const clientId = typeof claims.azp === 'string' ? claims.azp : null;
			if (!userId || !clientId) return jsonRpcError(401, 'Access token is not bound to a user.');

			const [client, user] = await Promise.all([deps.loadClient(clientId), deps.loadUser(userId)]);
			if (!client || client.disabled) return jsonRpcError(403, 'This MCP client is disabled.');
			if (!user) return jsonRpcError(401, 'Unknown user.');
			if (user.suspended) return jsonRpcError(403, 'This account is suspended.');
			try {
				await deps.limits.assertNotSuspended({ userId });
			} catch (cause) {
				if (isHttpError(cause)) return jsonRpcError(cause.status, cause.body.message);
				throw cause;
			}

			const { rateLimitExecPerMin } = await deps.limits.getLimits();
			const byUser = deps.limits.checkRateLimit(
				`mcp:user:${userId}`,
				minRequestsPerUser(rateLimitExecPerMin),
				WINDOW_MS
			);
			if (!byUser.allowed) return rateLimited(byUser.retryAfterMs);

			const ctx: McpRequestContext = {
				userId,
				clientId,
				clientName: client.name,
				clientAddress: meta.clientAddress,
				scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : []
			};
			return deps.handle(verified, ctx);
		});
	};
}

/**
 * Same-origin only, plus any loopback origin in development (MCP Inspector's browser UI).
 * Non-browser clients send no `Origin` and are not affected.
 */
export function originPolicy(appOrigin: string, dev: boolean) {
	return (origin: string) => {
		if (origin === appOrigin) return true;
		if (!dev) return false;
		try {
			const { hostname } = new URL(origin);
			return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
		} catch {
			return false;
		}
	};
}
