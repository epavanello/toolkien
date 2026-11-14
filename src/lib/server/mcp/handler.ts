/**
 * The MCP Streamable HTTP handler behind `/mcp`, after the bearer token was verified.
 *
 * Version negotiation is the SDK's `createMcpHandler`: requests carrying the 2026-07-28
 * `_meta` envelope are served by the modern per-request path; everything else (the
 * `initialize` handshake of 2025-11-25 clients and their later requests) by the stateless
 * legacy fallback. Both build a fresh server from the same factory, so the two eras expose the
 * same six tools. Neither keeps sessions: no `Mcp-Session-Id`, GET/DELETE answer 405.
 */
import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server';
import { drainOnCancel, withoutClientAbort } from './client-detach.ts';
import type { McpDeps } from './deps.ts';
import { createToolkienServer } from './server.ts';
import type { HandleMcpRequest, McpRequestContext } from './types.ts';

const IDENTITY_KEY = 'toolkien';

export function createHandleMcpRequest(options: {
	deps: McpDeps;
	stateKey: Uint8Array;
	/** Reporting only; must not log payloads */
	onerror?: (error: Error) => void;
}): HandleMcpRequest {
	const handler = createMcpHandler(
		({ era, authInfo }) => {
			const request = authInfo?.extra?.[IDENTITY_KEY] as McpRequestContext | undefined;
			// The endpoint always passes the verified identity; refuse to serve without one
			if (!request) throw new Error('MCP request without a verified identity');
			return createToolkienServer({
				era,
				request,
				deps: options.deps,
				stateKey: options.stateKey
			});
		},
		{ legacy: 'stateless', onerror: options.onerror }
	);

	return async (request, ctx) => {
		const authInfo: AuthInfo = {
			// Never forwarded anywhere: the SDK only hands it to our own handlers
			token: 'verified',
			clientId: ctx.clientId,
			scopes: ctx.scopes,
			extra: { [IDENTITY_KEY]: ctx }
		};
		const response = await handler.fetch(withoutClientAbort(request), { authInfo });
		return new Response(drainOnCancel(response.body), {
			status: response.status,
			headers: response.headers
		});
	};
}
