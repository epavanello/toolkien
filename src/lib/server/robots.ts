/**
 * Indexing rules shared by `robots.txt` and the `X-Robots-Tag` header set in hooks: app surfaces
 * (workspaces, approvals, admin, invitations, OAuth consent, APIs) never belong in search results,
 * and neither do error responses.
 */

/** Path prefixes of signed-in or machine surfaces (also `Disallow`ed in robots.txt) */
export const PRIVATE_PREFIXES = [
	'/w/',
	'/admin',
	'/approve',
	'/invite/',
	'/consent',
	'/login/confirm',
	'/connectors/oauth/',
	'/api/',
	'/mcp'
] as const;

/** JSON-only surfaces: MCP, Better Auth API, OAuth discovery. Their errors are never HTML. */
export const isMachinePath = (pathname: string) =>
	pathname === '/mcp' ||
	pathname.startsWith('/mcp/') ||
	pathname.startsWith('/api/') ||
	pathname.startsWith('/.well-known/');

export const isPrivatePath = (pathname: string) =>
	PRIVATE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));

/** `X-Robots-Tag` value for a response, or null when the page may be indexed */
export const robotsTag = (pathname: string, status: number): string | null =>
	status >= 400 || isPrivatePath(pathname) ? 'noindex, nofollow' : null;
