import { mcpEndpoint, methodNotAllowed } from '#lib/server/mcp/index.ts';
import type { RequestHandler } from './$types';

/**
 * The Toolkien MCP server (Streamable HTTP, stateless). Bearer tokens only; see
 * `#lib/server/mcp/endpoint.ts` for the pipeline.
 */
export const POST: RequestHandler = ({ request, getClientAddress }) =>
	mcpEndpoint(request, { clientAddress: getClientAddress() });

/** No GET event stream and no sessions to delete (2026-07-28, and stateless 2025 serving) */
export const GET: RequestHandler = () => methodNotAllowed();
export const DELETE: RequestHandler = () => methodNotAllowed();
