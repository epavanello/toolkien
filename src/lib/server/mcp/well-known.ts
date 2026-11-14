/**
 * OAuth discovery documents for MCP clients, served at the origin root (`src/routes/.well-known`).
 *
 * The authorization server issuer is `${ORIGIN}/api/auth` (Better Auth's base path), so:
 * - RFC 9728 protected-resource metadata: `/.well-known/oauth-protected-resource/mcp`
 *   (path-inserted, what the `/mcp` 401 challenge points to) and the root variant.
 * - RFC 8414 authorization-server metadata: `/.well-known/oauth-authorization-server/api/auth`
 *   (path-inserted, the spec location) and the root, for 2025-03-26-era clients that probe
 *   the resource origin.
 * - OpenID configuration: `/.well-known/openid-configuration/api/auth` and the root (the
 *   path-appended `/api/auth/.well-known/openid-configuration` is served by Better Auth).
 *
 * Better Auth's `mcp()` plugin answers the protected-resource paths and the path-inserted
 * authorization-server path from its `onRequest` hook; the root variants use the provider's
 * exported metadata helpers. All documents are public and CORS-enabled.
 */
import {
	oauthProviderAuthServerMetadata,
	oauthProviderOpenIdConfigMetadata
} from '@better-auth/oauth-provider';
import { auth } from '#lib/server/auth.ts';

/** Better Auth's default base path (not overridden in `auth.ts`): the issuer is `${ORIGIN}/api/auth` */
const ISSUER_PATH = 'api/auth';
const RESOURCE_PATH = 'mcp';

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, MCP-Protocol-Version'
};

const authServerMetadata = oauthProviderAuthServerMetadata(auth, { headers: CORS_HEADERS });
const openIdMetadata = oauthProviderOpenIdConfigMetadata(auth, { headers: CORS_HEADERS });

const notFound = () => new Response('Not Found', { status: 404, headers: CORS_HEADERS });

function withCors(response: Response): Response {
	const headers = new Headers(response.headers);
	for (const [name, value] of Object.entries(CORS_HEADERS)) headers.set(name, value);
	return new Response(response.body, { status: response.status, headers });
}

/** Normalises the `[...path]` rest parameter (`''`, `'mcp'`, `'api/auth'`) */
const clean = (path: string | undefined) => (path ?? '').replace(/^\/+|\/+$/g, '');

export type WellKnownDocument =
	'oauth-protected-resource' | 'oauth-authorization-server' | 'openid-configuration';

/** Serves one discovery document for `GET`/`HEAD`; `OPTIONS` answers the CORS preflight */
export async function serveWellKnown(
	document: WellKnownDocument,
	path: string | undefined,
	request: Request
): Promise<Response> {
	if (request.method === 'OPTIONS') {
		return new Response(null, { status: 204, headers: CORS_HEADERS });
	}
	const rest = clean(path);
	switch (document) {
		case 'oauth-protected-resource': {
			if (rest !== '' && rest !== RESOURCE_PATH) return notFound();
			// Canonical path (no trailing slash): the plugin matches it exactly
			const canonical = `/.well-known/oauth-protected-resource${rest ? `/${rest}` : ''}`;
			const url = new URL(canonical, request.url);
			return withCors(await auth.handler(new Request(url, { method: request.method })));
		}
		case 'oauth-authorization-server':
			if (rest !== '' && rest !== ISSUER_PATH) return notFound();
			return authServerMetadata(request);
		case 'openid-configuration':
			if (rest !== '' && rest !== ISSUER_PATH) return notFound();
			return openIdMetadata(request);
	}
}
