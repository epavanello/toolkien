import { createMcpHandler, Server, type McpHttpHandler } from '@modelcontextprotocol/server';

/**
 * Test-only: an in-process remote MCP server reached through a fake `safeFetch`, optionally
 * OAuth-protected (PRM + AS metadata, DCR, PKCE authorization code, refresh, revocation).
 * No sockets: requests are routed by host to `handler.fetch`.
 */

export type FakeTool = {
	name: string;
	title?: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: Record<string, unknown>;
	/** Result builder; return `{ isError: true, … }` for tool errors */
	call?: (args: Record<string, unknown>) => Record<string, unknown>;
};

export type FakeServerOptions = {
	host: string;
	tools: FakeTool[];
	listChanged?: boolean;
	/** Require a bearer token; `oauth` also serves the authorization server */
	auth?: { kind: 'token'; token: string | string[] } | { kind: 'oauth' };
	/** Only serve 2025-era traffic (no `server/discover`) */
	legacyOnly?: boolean;
	/**
	 * OAuth: serve the protected resource metadata only at this path (named by the 401
	 * challenge; the well-known paths 404) with `resource` = the origin, like servers built on
	 * Better Auth's MCP plugin
	 */
	prmPath?: string;
	/** Never answer `/mcp` (detection timeouts) */
	hang?: boolean;
};

export type FakeServer = {
	host: string;
	url: string;
	tools: FakeTool[];
	handler: McpHttpHandler;
	fetch: (request: Request) => Promise<Response>;
	/** Replaces the tool list and publishes `tools/list_changed` */
	setTools(tools: FakeTool[]): void;
	calls: { name: string; args: Record<string, unknown>; authorization: string | null }[];
	/** The browser opening the authorization URL (records the request) */
	visitAuthorize(authorizationUrl: string): void;
	oauth: {
		accessTokens: Set<string>;
		refreshTokens: Set<string>;
		revoked: string[];
		registrations: Record<string, unknown>[];
		lastAuthorize: URLSearchParams | null;
		/** Issues a code for the last authorization request (the "user consented" step) */
		approve(): { code: string; state: string };
		/** Expires every access token (forces refresh) */
		expireAccessTokens(): void;
	};
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers }
	});

async function sha256Base64Url(value: string) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Buffer.from(digest).toString('base64url');
}

export function createFakeServer(options: FakeServerOptions): FakeServer {
	const origin = `https://${options.host}`;
	const url = `${origin}/mcp`;
	const fake = { tools: [...options.tools] } as { tools: FakeTool[] };
	const calls: FakeServer['calls'] = [];
	let currentAuthorization: string | null = null;

	const factory = () => {
		const server = new Server(
			{ name: `fake-${options.host}`, version: '1.0.0' },
			{ capabilities: { tools: { listChanged: options.listChanged ?? false } } }
		);
		server.setRequestHandler('tools/list', async () => ({
			tools: fake.tools.map(({ call: _call, ...tool }) => tool) as never
		}));
		server.setRequestHandler('tools/call', async (request) => {
			const { name, arguments: args = {} } = request.params as {
				name: string;
				arguments?: Record<string, unknown>;
			};
			const tool = fake.tools.find((t) => t.name === name);
			if (!tool) {
				const { ProtocolError } = await import('@modelcontextprotocol/server');
				throw new ProtocolError(-32602, `Unknown tool: ${name}`);
			}
			calls.push({ name, args, authorization: currentAuthorization });
			return (tool.call?.(args) ?? { content: [{ type: 'text', text: 'ok' }] }) as never;
		});
		return server;
	};
	const handler = createMcpHandler(factory, { legacy: 'stateless' });

	// OAuth state
	const accessTokens = new Set<string>();
	const refreshTokens = new Set<string>();
	const codes = new Map<
		string,
		{ challenge: string; clientId: string; redirectUri: string; resource: string | null }
	>();
	const revoked: string[] = [];
	const registrations: Record<string, unknown>[] = [];
	let lastAuthorize: URLSearchParams | null = null;
	let counter = 0;
	const issue = () => {
		const access = `at-${options.host}-${++counter}`;
		const refresh = `rt-${options.host}-${counter}`;
		accessTokens.add(access);
		refreshTokens.add(refresh);
		return {
			access_token: access,
			refresh_token: refresh,
			token_type: 'Bearer',
			expires_in: 3600,
			scope: 'read'
		};
	};

	const authorized = (request: Request) => {
		const header = request.headers.get('authorization');
		currentAuthorization = header;
		if (!options.auth) return true;
		const token = header?.replace(/^Bearer /, '');
		if (options.auth.kind === 'token') return [options.auth.token].flat().includes(token ?? '');
		return !!token && accessTokens.has(token);
	};

	async function route(request: Request): Promise<Response> {
		const path = new URL(request.url).pathname;
		if (options.auth?.kind === 'oauth') {
			if (options.prmPath && path === options.prmPath) {
				return json({ resource: origin, authorization_servers: [origin], scopes_supported: ['read'] });
			}
			if (!options.prmPath && path.startsWith('/.well-known/oauth-protected-resource')) {
				return json({
					resource: url,
					authorization_servers: [origin],
					scopes_supported: ['read', 'write']
				});
			}
			if (path === '/.well-known/oauth-authorization-server') {
				return json({
					issuer: origin,
					authorization_endpoint: `${origin}/authorize`,
					token_endpoint: `${origin}/token`,
					registration_endpoint: `${origin}/register`,
					revocation_endpoint: `${origin}/revoke`,
					response_types_supported: ['code'],
					grant_types_supported: ['authorization_code', 'refresh_token'],
					code_challenge_methods_supported: ['S256'],
					token_endpoint_auth_methods_supported: ['none']
				});
			}
			if (path === '/register' && request.method === 'POST') {
				const body = (await request.json()) as Record<string, unknown>;
				registrations.push(body);
				return json({ ...body, client_id: `client-${registrations.length}` }, 201);
			}
			if (path === '/token' && request.method === 'POST') {
				const form = new URLSearchParams(await request.text());
				if (form.get('grant_type') === 'authorization_code') {
					const code = codes.get(form.get('code') ?? '');
					codes.delete(form.get('code') ?? '');
					if (
						!code ||
						code.redirectUri !== form.get('redirect_uri') ||
						(await sha256Base64Url(form.get('code_verifier') ?? '')) !== code.challenge
					) {
						return json({ error: 'invalid_grant' }, 400);
					}
					return json(issue());
				}
				if (form.get('grant_type') === 'refresh_token') {
					const refresh = form.get('refresh_token') ?? '';
					if (!refreshTokens.delete(refresh)) return json({ error: 'invalid_grant' }, 400);
					return json(issue());
				}
				return json({ error: 'unsupported_grant_type' }, 400);
			}
			if (path === '/revoke' && request.method === 'POST') {
				const token = new URLSearchParams(await request.text()).get('token') ?? '';
				revoked.push(token);
				accessTokens.delete(token);
				refreshTokens.delete(token);
				return new Response(null, { status: 200 });
			}
		}
		if (path === '/mcp') {
			if (options.hang) return new Promise<Response>(() => undefined);
			if (!authorized(request)) {
				const metadata = options.prmPath ?? '/.well-known/oauth-protected-resource/mcp';
				return json({ error: 'unauthorized' }, 401, {
					'www-authenticate': `Bearer resource_metadata="${origin}${metadata}", scope="read"`
				});
			}
			if (options.legacyOnly && request.method === 'POST') {
				const body = await request.clone().text();
				if (body.includes('server/discover')) {
					return json(
						{
							jsonrpc: '2.0',
							id: JSON.parse(body).id,
							error: { code: -32601, message: 'Method not found' }
						},
						200
					);
				}
			}
			return handler.fetch(request);
		}
		return new Response('not found', { status: 404 });
	}

	return {
		host: options.host,
		url,
		get tools() {
			return fake.tools;
		},
		handler,
		fetch: route,
		setTools(tools) {
			fake.tools = tools;
			handler.notify.toolsChanged();
		},
		calls,
		oauth: {
			accessTokens,
			refreshTokens,
			revoked,
			registrations,
			get lastAuthorize() {
				return lastAuthorize;
			},
			approve() {
				if (!lastAuthorize) throw new Error('no authorization request');
				const code = `code-${++counter}`;
				codes.set(code, {
					challenge: lastAuthorize.get('code_challenge') ?? '',
					clientId: lastAuthorize.get('client_id') ?? '',
					redirectUri: lastAuthorize.get('redirect_uri') ?? '',
					resource: lastAuthorize.get('resource')
				});
				return { code, state: lastAuthorize.get('state') ?? '' };
			},
			expireAccessTokens() {
				accessTokens.clear();
			}
		},
		visitAuthorize(authorizationUrl) {
			lastAuthorize = new URL(authorizationUrl).searchParams;
		}
	};
}

/** A `safeFetch` replacement routing `https://<host>/…` to the matching fake server */
export function fakeNetwork(servers: () => FakeServer[]) {
	return async (input: string | URL, init?: RequestInit): Promise<Response> => {
		const url = new URL(String(input));
		if (url.protocol !== 'https:') throw new Error('blocked: https only');
		const server = servers().find((s) => s.host === url.host);
		if (!server) throw new Error(`no fake server for ${url.host}`);
		const {
			timeoutMs: _t,
			maxRedirects: _m,
			maxResponseBytes: _b,
			...rest
		} = (init ?? {}) as RequestInit & Record<string, unknown>;
		return server.fetch(new Request(url, rest as RequestInit));
	};
}
