/**
 * Security headers added to every response. The Content-Security-Policy itself is configured
 * in `vite.config.ts` (`kit.csp`) so SvelteKit can add nonces to its inline scripts.
 */
export function securityHeaders({ production }: { production: boolean }): Record<string, string> {
	return {
		'X-Content-Type-Options': 'nosniff',
		'X-Frame-Options': 'DENY',
		'Referrer-Policy': 'strict-origin-when-cross-origin',
		'Cross-Origin-Opener-Policy': 'same-origin',
		'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
		...(production ? { 'Strict-Transport-Security': 'max-age=63072000; includeSubDomains' } : {})
	};
}

/** `/mcp` authenticates with bearer tokens only: cookies must never authorize it */
export const isBearerOnlyPath = (pathname: string) =>
	pathname === '/mcp' || pathname.startsWith('/mcp/');

/**
 * OAuth endpoints called server-to-server by MCP clients (no browser, no Origin header, form
 * encoded per RFC 6749). They authenticate with the client's credentials / PKCE verifier, never
 * with cookies, so the origin check does not apply to them.
 */
const CSRF_EXEMPT_PATHS = new Set([
	'/api/auth/oauth2/token',
	'/api/auth/oauth2/register',
	'/api/auth/oauth2/revoke',
	'/api/auth/oauth2/introspect'
]);

const FORM_CONTENT_TYPES = [
	'application/x-www-form-urlencoded',
	'multipart/form-data',
	'text/plain'
];

/**
 * SvelteKit's built-in CSRF check is disabled (`csrf.trustedOrigins: ['*']` in vite.config.ts)
 * because it rejects the OAuth token endpoint before hooks run. This reimplements it: a
 * state-changing request with a form content type must come from our own origin, except the
 * exempt OAuth endpoints above.
 */
export function isCrossSiteFormRequest(request: Request, url: URL): boolean {
	if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return false;
	const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
	if (!FORM_CONTENT_TYPES.includes(type)) return false;
	if (CSRF_EXEMPT_PATHS.has(url.pathname)) return false;
	return request.headers.get('origin') !== url.origin;
}
