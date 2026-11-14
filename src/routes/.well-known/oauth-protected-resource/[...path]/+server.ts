import { serveWellKnown } from '#lib/server/mcp/well-known.ts';
import type { RequestHandler } from './$types';

/** Discovery document for MCP clients (root and path-inserted); see `well-known.ts` */
export const GET: RequestHandler = ({ params, request }) =>
	serveWellKnown('oauth-protected-resource', params.path, request);

export const OPTIONS: RequestHandler = ({ params, request }) =>
	serveWellKnown('oauth-protected-resource', params.path, request);
