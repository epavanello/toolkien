/**
 * End to end, in process: OAuth discovery, client registration (DCR and CIMD), PKCE, resource
 * indicator and token audience, then MCP initialize / tools/list / tools/call over both
 * protocol eras with the real SDK client, including a 2026-07-28 form elicitation round.
 *
 * Real: Better Auth (auth.ts), the `/mcp` endpoint pipeline, the MCP handler and tools, the
 * workspaces module, an in-memory database. Faked: outbound fetch (the CIMD document) and the
 * connectors / executions / permissions contracts (owned by other verticals).
 */
import { createHash, randomBytes } from 'node:crypto';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.ts', async () => {
	const { createTestDb } = await import('#lib/server/workspaces/test-db.ts');
	return { db: await createTestDb() };
});

const CIMD_CLIENT_ID = 'https://client.example/oauth/client.json';
const CIMD_REDIRECT = 'http://127.0.0.1:4444/callback';

vi.mock('#lib/server/net/index.ts', () => ({
	assertSafeUrl: async (url: string) => new URL(url),
	safeFetch: async (input: string | URL) => {
		if (String(input) !== CIMD_CLIENT_ID) return new Response('not found', { status: 404 });
		return Response.json(
			{
				client_id: CIMD_CLIENT_ID,
				client_name: 'CIMD Test Client',
				client_uri: 'https://client.example',
				redirect_uris: [CIMD_REDIRECT],
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				token_endpoint_auth_method: 'none'
			},
			{ headers: { 'Cache-Control': 'max-age=60' } }
		);
	}
}));

vi.mock('./services.ts', async () => {
	const workspaces = await import('#lib/server/workspaces/index.ts');
	const audit = await import('#lib/server/audit/index.ts');
	const { fakeDeps } = await import('./testing.ts');
	const fakes = fakeDeps();
	return {
		services: {
			...fakes,
			workspaces,
			audit,
			origin: 'http://localhost:5173'
		}
	};
});

const { auth, MCP_RESOURCE } = await import('#lib/server/auth.ts');
const { mcpEndpoint } = await import('./index.ts');
const { serveWellKnown } = await import('./well-known.ts');
const { db } = await import('#lib/server/db/index.ts');
const schema = await import('#lib/server/db/schema/index.ts');

const ORIGIN = new URL(MCP_RESOURCE).origin;
const ISSUER = `${ORIGIN}/api/auth`;
const DCR_REDIRECT = 'http://127.0.0.1:3333/callback';

const b64url = (bytes: Buffer) => bytes.toString('base64url');
const pkce = () => {
	const verifier = b64url(randomBytes(32));
	return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) };
};
const decodeJwt = (token: string) =>
	JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as Record<string, unknown>;

const callAuth = (path: string, init: RequestInit = {}) =>
	auth.handler(new Request(`${ORIGIN}${path}`, init));

const mcpFetch = (url: string | URL, init?: RequestInit) =>
	mcpEndpoint(new Request(url, init), { clientAddress: '127.0.0.1' });

let cookie = '';
let userId = '';

async function signUp() {
	const response = await callAuth('/api/auth/sign-up/email', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
		body: JSON.stringify({
			name: 'Ada',
			email: 'ada@example.com',
			password: 'correct horse battery staple'
		})
	});
	expect(response.status).toBe(200);
	cookie = response.headers
		.getSetCookie()
		.map((value) => value.split(';')[0])
		.join('; ');
	userId = ((await response.json()) as { user: { id: string } }).user.id;
}

/** Authorize → consent (if asked) → code; returns the redirect URL with `code` / `error` */
async function authorize(params: Record<string, string>): Promise<URL> {
	const response = await callAuth(`/api/auth/oauth2/authorize?${new URLSearchParams(params)}`, {
		headers: { cookie, accept: 'text/html' },
		redirect: 'manual'
	});
	expect(response.status).toBe(302);
	let location = new URL(response.headers.get('location')!, ORIGIN);
	if (location.pathname === '/consent') {
		const consent = await callAuth('/api/auth/oauth2/consent', {
			method: 'POST',
			headers: { cookie, 'Content-Type': 'application/json', Origin: ORIGIN },
			body: JSON.stringify({ accept: true, oauth_query: location.search.slice(1) })
		});
		expect(consent.status).toBe(200);
		location = new URL(((await consent.json()) as { url: string }).url);
	}
	return location;
}

async function token(body: Record<string, string>) {
	const response = await callAuth('/api/auth/oauth2/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(body)
	});
	return { status: response.status, body: (await response.json()) as Record<string, string> };
}

/** Full authorization-code flow for a client; returns the token response */
async function login(clientId: string, redirectUri: string, extra: Record<string, string> = {}) {
	const { verifier, challenge } = pkce();
	const redirect = await authorize({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: 'openid offline_access',
		state: 'xyz',
		code_challenge: challenge,
		code_challenge_method: 'S256',
		resource: MCP_RESOURCE,
		...extra
	});
	expect(redirect.searchParams.get('state')).toBe('xyz');
	expect(redirect.searchParams.get('iss')).toBe(ISSUER);
	const code = redirect.searchParams.get('code')!;
	expect(code).toBeTruthy();
	return token({
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
		client_id: clientId,
		code_verifier: verifier,
		resource: MCP_RESOURCE
	});
}

let dcrClientId = '';
let accessToken = '';

beforeAll(async () => {
	await signUp();
});

afterEach(() => vi.useRealTimers());

describe('discovery', () => {
	it('challenges unauthenticated requests with the protected-resource metadata URL', async () => {
		const response = await mcpFetch(MCP_RESOURCE, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
		});
		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toContain(
			`resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/mcp"`
		);
	});

	it('publishes protected-resource metadata (path-inserted and root)', async () => {
		for (const path of ['mcp', '']) {
			const response = await serveWellKnown(
				'oauth-protected-resource',
				path,
				new Request(`${ORIGIN}/.well-known/oauth-protected-resource/${path}`)
			);
			const body = (await response.json()) as Record<string, unknown>;
			expect(body.resource).toBe(MCP_RESOURCE);
			expect(body.authorization_servers).toEqual([ISSUER]);
			expect(response.headers.get('access-control-allow-origin')).toBe('*');
		}
	});

	it('publishes authorization-server metadata (path-inserted and root)', async () => {
		for (const path of ['api/auth', '']) {
			const response = await serveWellKnown(
				'oauth-authorization-server',
				path,
				new Request(`${ORIGIN}/.well-known/oauth-authorization-server/${path}`)
			);
			const body = (await response.json()) as Record<string, unknown>;
			expect(body.issuer).toBe(ISSUER);
			expect(body.code_challenge_methods_supported).toEqual(['S256']);
			expect(body.client_id_metadata_document_supported).toBe(true);
			expect(body.registration_endpoint).toBe(`${ISSUER}/oauth2/register`);
			expect(body.authorization_response_iss_parameter_supported).toBe(true);
			expect(body.grant_types_supported).toEqual(['authorization_code', 'refresh_token']);
		}
		const openid = await serveWellKnown(
			'openid-configuration',
			'api/auth',
			new Request(`${ORIGIN}/.well-known/openid-configuration/api/auth`)
		);
		expect(((await openid.json()) as { issuer: string }).issuer).toBe(ISSUER);
	});
});

describe('OAuth', () => {
	it('registers a public client with DCR', async () => {
		const response = await callAuth('/api/auth/oauth2/register', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				client_name: 'DCR Test Client',
				redirect_uris: [DCR_REDIRECT],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code']
			})
		});
		expect(response.status).toBe(201);
		dcrClientId = ((await response.json()) as { client_id: string }).client_id;
		expect(dcrClientId).toBeTruthy();
	});

	it('issues 15-minute access tokens bound to the MCP resource (PKCE S256)', async () => {
		const { status, body } = await login(dcrClientId, DCR_REDIRECT);
		expect(status).toBe(200);
		expect(body.refresh_token).toBeTruthy();
		accessToken = body.access_token;
		const claims = decodeJwt(accessToken);
		expect([claims.aud].flat()).toContain(MCP_RESOURCE);
		expect(claims.iss).toBe(ISSUER);
		expect(claims.azp).toBe(dcrClientId);
		expect(claims.sub).toBe(userId);
		expect(Number(claims.exp) - Number(claims.iat)).toBe(15 * 60);
	});

	it('requires PKCE and refuses a wrong verifier', async () => {
		const missing = await authorize({
			response_type: 'code',
			client_id: dcrClientId,
			redirect_uri: DCR_REDIRECT,
			scope: 'openid',
			resource: MCP_RESOURCE
		});
		expect(missing.searchParams.get('error')).toBe('invalid_request');

		const { challenge } = pkce();
		const redirect = await authorize({
			response_type: 'code',
			client_id: dcrClientId,
			redirect_uri: DCR_REDIRECT,
			scope: 'openid',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			resource: MCP_RESOURCE
		});
		const wrong = await token({
			grant_type: 'authorization_code',
			code: redirect.searchParams.get('code')!,
			redirect_uri: DCR_REDIRECT,
			client_id: dcrClientId,
			code_verifier: pkce().verifier,
			resource: MCP_RESOURCE
		});
		expect(wrong.status).toBe(400);
		expect(wrong.body.error).toBe('invalid_grant');
	});

	it('makes tokens without the resource indicator useless on /mcp', async () => {
		const { verifier, challenge } = pkce();
		const redirect = await authorize({
			response_type: 'code',
			client_id: dcrClientId,
			redirect_uri: DCR_REDIRECT,
			scope: 'openid',
			code_challenge: challenge,
			code_challenge_method: 'S256'
		});
		const { body } = await token({
			grant_type: 'authorization_code',
			code: redirect.searchParams.get('code')!,
			redirect_uri: DCR_REDIRECT,
			client_id: dcrClientId,
			code_verifier: verifier
		});
		const response = await mcpFetch(MCP_RESOURCE, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${body.access_token}`,
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
		});
		expect(response.status).toBe(401);
	});

	it('rotates refresh tokens and revokes the family on reuse', async () => {
		const first = await login(dcrClientId, DCR_REDIRECT);
		const rotated = await token({
			grant_type: 'refresh_token',
			refresh_token: first.body.refresh_token,
			client_id: dcrClientId,
			resource: MCP_RESOURCE
		});
		expect(rotated.status).toBe(200);
		expect(rotated.body.refresh_token).not.toBe(first.body.refresh_token);

		// Past the 30 s retry window, reusing the old token is a replay
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + 60_000);
		const replay = await token({
			grant_type: 'refresh_token',
			refresh_token: first.body.refresh_token,
			client_id: dcrClientId,
			resource: MCP_RESOURCE
		});
		expect(replay.status).toBe(400);
		const afterReplay = await token({
			grant_type: 'refresh_token',
			refresh_token: rotated.body.refresh_token,
			client_id: dcrClientId,
			resource: MCP_RESOURCE
		});
		expect(afterReplay.status).toBe(400);
	});

	it('accepts a Client ID Metadata Document client', async () => {
		const { status, body } = await login(CIMD_CLIENT_ID, CIMD_REDIRECT);
		expect(status).toBe(200);
		expect(decodeJwt(body.access_token).azp).toBe(CIMD_CLIENT_ID);
		const [client] = await db
			.select({ name: schema.oauthClient.name })
			.from(schema.oauthClient)
			.where((await import('drizzle-orm')).eq(schema.oauthClient.clientId, CIMD_CLIENT_ID));
		expect(client.name).toBe('CIMD Test Client');
	});
});

describe('MCP', () => {
	const transport = () =>
		new StreamableHTTPClientTransport(new URL(MCP_RESOURCE), {
			fetch: mcpFetch,
			requestInit: { headers: { Authorization: `Bearer ${accessToken}` } }
		});

	it('serves a 2025-11-25 client: initialize, tools/list, tools/call', async () => {
		const client = new Client({ name: 'legacy-test', version: '1.0.0' });
		await client.connect(transport());
		expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
		const { tools } = await client.listTools();
		expect(tools.map((tool) => tool.name).sort()).toEqual(
			[
				'execute',
				'execution_status',
				'tools_describe',
				'tools_search',
				'workspace_list',
				'workspace_switch'
			].sort()
		);
		const result = await client.callTool({ name: 'workspace_list', arguments: {} });
		expect(JSON.stringify(result.content)).toContain('Active workspace: Personal');
		await client.close();
	});

	it('serves a 2026-07-28 client and confirms a switch through a form elicitation', async () => {
		const workspaceId = crypto.randomUUID();
		await db.insert(schema.organization).values({
			id: workspaceId,
			name: 'Acme',
			slug: 'acme',
			kind: 'company',
			createdAt: new Date()
		});
		await db.insert(schema.member).values({
			id: crypto.randomUUID(),
			organizationId: workspaceId,
			userId,
			role: 'member',
			createdAt: new Date()
		});

		const client = new Client(
			{ name: 'modern-test', version: '1.0.0' },
			{
				capabilities: { elicitation: { form: {} } },
				versionNegotiation: { mode: { pin: '2026-07-28' } }
			}
		);
		const asked: string[] = [];
		client.setRequestHandler('elicitation/create', async (request) => {
			asked.push(String(request.params.message));
			return { action: 'accept', content: { confirm: true } };
		});
		await client.connect(transport());
		expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');

		const result = await client.callTool({
			name: 'workspace_switch',
			arguments: { workspace: 'acme' }
		});
		expect(asked[0]).toContain('To: Acme');
		expect(JSON.stringify(result.content)).toContain('Switched to Acme (acme)');

		const list = await client.callTool({ name: 'workspace_list', arguments: {} });
		expect(JSON.stringify(list.content)).toContain('Active workspace: Acme (acme)');
		await client.close();
	});
});
