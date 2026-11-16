/**
 * The `/mcp` HTTP pipeline, in order:
 * 1. POST only (stateless server: GET/DELETE and the rest answer 405).
 * 2. Origin validation (DNS rebinding): a browser `Origin` must be ours.
 * 3. Rate limit per IP, before any token work.
 * 4. Bearer token: signature, issuer, expiry, `aud = ${ORIGIN}/mcp` (Better Auth
 *    `requireMcpAuth`); failures get the RFC 9728 `WWW-Authenticate` challenge.
 * 5. The connection the token names (`connection_id` claim, one per approval): it must exist
 *    and belong to the token's user and client; a token without one (issued before connections)
 *    gets the challenge, so the client signs in again.
 * 6. Kill switches: disabled OAuth client, suspended user (`limits.assertNotSuspended`), and a
 *    connection the user disconnected (access tokens are JWTs verified offline: without a live
 *    grant they get the challenge again instead of working until they expire).
 * 7. Rate limit per user.
 * 8. The MCP handler, with the connection, its name (the user's name for it, else the OAuth
 *    registration name) and the MCP `clientInfo` captured for the audit: from the request's
 *    2026-07-28 envelope, else from `initialize` (remembered on the connection, since 2025-era
 *    clients send it only once). Display only.
 *
 * Cookies are never read here (the hooks skip sessions on `/mcp`).
 */
import { isHttpError } from '@sveltejs/kit';
import type { LimitsService } from '#lib/server/limits/types.ts';
import { peekClientInfo } from './client-info.ts';
import type { HandleMcpRequest, McpRequestContext } from './types.ts';

/** Verified claims of the access token (subset of the JWT payload) */
export type AccessTokenClaims = {
	sub?: unknown;
	azp?: unknown;
	scope?: unknown;
	/** `CONNECTION_CLAIM`: the MCP connection of the grant */
	connection_id?: unknown;
};

/** What the endpoint needs of an MCP connection */
export type EndpointConnection = {
	userId: string;
	clientId: string;
	/** The name the user gave it (consent screen, Connected clients), if any */
	label: string | null;
	/** MCP `clientInfo` (`name version`) it sent in its last `initialize` */
	clientInfo: string | null;
};

export type McpEndpointDeps = {
	handle: HandleMcpRequest;
	/** Verifies the bearer token, then calls `next`; otherwise answers the OAuth challenge */
	verify: (
		request: Request,
		next: (request: Request, claims: AccessTokenClaims) => Promise<Response>
	) => Promise<Response>;
	loadClient: (clientId: string) => Promise<{ name: string | null; disabled: boolean } | null>;
	loadUser: (userId: string) => Promise<{ suspended: boolean } | null>;
	/** The connection by id, `null` when it does not exist (disconnected) */
	loadConnection: (connectionId: string) => Promise<EndpointConnection | null>;
	/** The user still grants the connection access (consent and a live grant) */
	hasLiveGrant: (userId: string, connectionId: string) => Promise<boolean>;
	/** Stores the MCP `clientInfo` (`name version`) a connection sent in `initialize` */
	rememberClientInfo: (connectionId: string, info: string) => Promise<void>;
	/** RFC 9728 metadata URL, sent in the challenge when the grant is gone */
	resourceMetadataUrl: string;
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
			const connectionId = typeof claims.connection_id === 'string' ? claims.connection_id : null;
			const signInAgain = (message: string, description: string) =>
				jsonRpcError(401, message, {
					'WWW-Authenticate': `Bearer error="invalid_token", error_description="${description}", resource_metadata="${deps.resourceMetadataUrl}"`
				});
			// Issued before connections existed: one sign-in makes a token that names one
			if (!connectionId) {
				return signInAgain(
					'This access token predates connections. Sign in again.',
					'Sign in again'
				);
			}

			const [client, user, connection, granted] = await Promise.all([
				deps.loadClient(clientId),
				deps.loadUser(userId),
				deps.loadConnection(connectionId),
				deps.hasLiveGrant(userId, connectionId)
			]);
			if (!client || client.disabled) return jsonRpcError(403, 'This MCP client is disabled.');
			if (!user) return jsonRpcError(401, 'Unknown user.');
			// The connection must be the one this user approved for this very client
			if (
				!connection ||
				connection.userId !== userId ||
				connection.clientId !== clientId ||
				!granted
			) {
				return signInAgain(
					'This client was disconnected. Sign in again to reconnect it.',
					'The user disconnected this client'
				);
			}
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
				connectionId,
				clientName: connection.label ?? client.name,
				clientInfo: await requestClientInfo(deps, verified, connectionId, connection.clientInfo),
				clientAddress: meta.clientAddress,
				scopes: typeof claims.scope === 'string' ? claims.scope.split(' ').filter(Boolean) : []
			};
			return deps.handle(verified, ctx);
		});
	};
}

/** Never fails the request: client info is a label for the activity, nothing more */
async function requestClientInfo(
	deps: McpEndpointDeps,
	request: Request,
	connectionId: string,
	remembered: string | null
): Promise<string | null> {
	try {
		const peeked = await peekClientInfo(request);
		if (peeked.info && peeked.fromInitialize && peeked.info !== remembered) {
			await deps.rememberClientInfo(connectionId, peeked.info);
		}
		return peeked.info ?? remembered;
	} catch {
		return remembered;
	}
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
