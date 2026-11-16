import { error } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import {
	createMcpEndpoint,
	minRequestsPerUser,
	originPolicy,
	type AccessTokenClaims,
	type McpEndpointDeps
} from './endpoint.ts';

const claims: AccessTokenClaims = { sub: 'u1', azp: 'client-1', scope: 'openid offline_access' };

function setup(overrides: Partial<McpEndpointDeps> = {}) {
	const deps = {
		handle: vi.fn(async () => new Response('ok')),
		verify: vi.fn<McpEndpointDeps['verify']>(async (request, next) => next(request, claims)),
		loadClient: vi.fn(async () => ({ name: 'Claude', disabled: false })),
		loadUser: vi.fn(async () => ({ suspended: false })),
		hasLiveGrant: vi.fn(async () => true),
		clientInfo: {
			remember: vi.fn(async () => {}),
			load: vi.fn(async (): Promise<string | null> => null)
		},
		resourceMetadataUrl: 'https://toolkien.test/.well-known/oauth-protected-resource/mcp',
		limits: {
			checkRateLimit: vi.fn(() => ({ allowed: true as const })),
			assertNotSuspended: vi.fn(async () => {}),
			getLimits: vi.fn(async () => ({
				execTimeoutMs: 1,
				execMaxToolCalls: 1,
				execMaxOutputBytes: 1,
				rateLimitExecPerMin: 60,
				maxConcurrentPerUser: 1,
				maxConcurrentGlobal: 1
			}))
		},
		isAllowedOrigin: originPolicy('https://toolkien.test', false),
		...overrides
	} satisfies McpEndpointDeps;
	const endpoint = createMcpEndpoint(deps);
	const post = (headers: Record<string, string> = {}, body: unknown = {}) =>
		endpoint(
			new Request('https://toolkien.test/mcp', {
				method: 'POST',
				headers: { 'content-type': 'application/json', ...headers },
				body: JSON.stringify(body)
			}),
			{ clientAddress: '203.0.113.7' }
		);
	return { deps, endpoint, post };
}

describe('/mcp endpoint', () => {
	it('answers 405 to GET and DELETE (no event stream, no sessions)', async () => {
		const { endpoint, deps } = setup();
		for (const method of ['GET', 'DELETE']) {
			const response = await endpoint(new Request('https://toolkien.test/mcp', { method }), {
				clientAddress: '::1'
			});
			expect(response.status).toBe(405);
			expect(response.headers.get('allow')).toBe('POST');
		}
		expect(deps.verify).not.toHaveBeenCalled();
	});

	it('rejects foreign browser origins before reading the token', async () => {
		const { post, deps } = setup();
		expect((await post({ origin: 'https://evil.test' })).status).toBe(403);
		expect(deps.verify).not.toHaveBeenCalled();
		expect((await post({ origin: 'https://toolkien.test' })).status).toBe(200);
		expect((await post()).status).toBe(200);
	});

	it('rate limits per IP before verifying and per user after', async () => {
		const limited = setup();
		vi.mocked(limited.deps.limits.checkRateLimit).mockReturnValueOnce({
			allowed: false,
			retryAfterMs: 1500
		} as never);
		const response = await limited.post();
		expect(response.status).toBe(429);
		expect(response.headers.get('retry-after')).toBe('2');
		expect(limited.deps.verify).not.toHaveBeenCalled();

		const perUser = setup();
		vi.mocked(perUser.deps.limits.checkRateLimit)
			.mockReturnValueOnce({ allowed: true })
			.mockReturnValueOnce({ allowed: false, retryAfterMs: 10 } as never);
		expect((await perUser.post()).status).toBe(429);
		expect(perUser.deps.limits.checkRateLimit).toHaveBeenLastCalledWith(
			'mcp:user:u1',
			minRequestsPerUser(60),
			60_000
		);
	});

	it('rejects a token of a client the user disconnected, with the OAuth challenge', async () => {
		const { post, deps } = setup({ hasLiveGrant: vi.fn(async () => false) });
		const response = await post();
		expect(response.status).toBe(401);
		expect(response.headers.get('www-authenticate')).toMatch(
			/^Bearer error="invalid_token".*resource_metadata="https:\/\/toolkien\.test\/\.well-known\/oauth-protected-resource\/mcp"$/
		);
		expect(deps.hasLiveGrant).toHaveBeenCalledWith('u1', 'client-1');
		expect(deps.handle).not.toHaveBeenCalled();
	});

	it('applies kill switches: disabled client, suspended user', async () => {
		const disabled = setup({ loadClient: vi.fn(async () => ({ name: 'X', disabled: true })) });
		expect((await disabled.post()).status).toBe(403);

		const suspendedRow = setup({ loadUser: vi.fn(async () => ({ suspended: true })) });
		expect((await suspendedRow.post()).status).toBe(403);

		const switched = setup();
		vi.mocked(switched.deps.limits.assertNotSuspended).mockImplementationOnce(async () =>
			error(403, 'Suspended by an administrator.', { code: 'SUSPENDED' })
		);
		const response = await switched.post();
		expect(response.status).toBe(403);
		expect(await response.json()).toMatchObject({
			error: { message: 'Suspended by an administrator.' }
		});
		expect(switched.deps.handle).not.toHaveBeenCalled();
	});

	it('passes the verified identity and client name to the handler', async () => {
		const { post, deps } = setup();
		await post();
		expect(deps.handle).toHaveBeenCalledWith(expect.any(Request), {
			userId: 'u1',
			clientId: 'client-1',
			clientName: 'Claude',
			clientInfo: null,
			clientAddress: '203.0.113.7',
			scopes: ['openid', 'offline_access']
		});
	});

	it('labels requests with the MCP client info of the 2026-07-28 envelope', async () => {
		const { post, deps } = setup();
		await post(
			{},
			{
				jsonrpc: '2.0',
				id: 1,
				method: 'tools/call',
				params: {
					name: 'tools_search',
					arguments: { query: 'issues' },
					_meta: {
						'io.modelcontextprotocol/clientInfo': { name: 'claude-code', version: '2.1.3' }
					}
				}
			}
		);
		expect(deps.handle).toHaveBeenCalledWith(
			expect.any(Request),
			expect.objectContaining({ clientInfo: 'claude-code 2.1.3' })
		);
		expect(deps.clientInfo.remember).not.toHaveBeenCalled();
		expect(deps.clientInfo.load).not.toHaveBeenCalled();
	});

	it('remembers the client info of a 2025-era initialize for later stateless requests', async () => {
		const { post, deps } = setup();
		await post(
			{},
			{
				jsonrpc: '2.0',
				id: 0,
				method: 'initialize',
				params: {
					protocolVersion: '2025-11-25',
					capabilities: {},
					clientInfo: { name: 'cursor-vscode\n', version: '1.0.0' }
				}
			}
		);
		expect(deps.clientInfo.remember).toHaveBeenCalledWith('u1', 'client-1', 'cursor-vscode 1.0.0');

		vi.mocked(deps.clientInfo.load).mockResolvedValueOnce('cursor-vscode 1.0.0');
		await post({}, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
		expect(deps.clientInfo.load).toHaveBeenCalledWith('u1', 'client-1');
		expect(deps.handle).toHaveBeenLastCalledWith(
			expect.any(Request),
			expect.objectContaining({ clientInfo: 'cursor-vscode 1.0.0' })
		);
	});

	it('never fails a request over client info, and leaves the body for the handler', async () => {
		const { post, deps } = setup({
			clientInfo: {
				remember: vi.fn(async () => {
					throw new Error('db down');
				}),
				load: vi.fn(async () => null)
			}
		});
		vi.mocked(deps.handle).mockImplementationOnce(
			async (request: Request) => new Response(await request.text())
		);
		const body = {
			jsonrpc: '2.0',
			id: 0,
			method: 'initialize',
			params: { clientInfo: { name: 'x', version: '1' } }
		};
		const response = await post({}, body);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(body);
	});

	it('refuses tokens without a user or client', async () => {
		const { post } = setup({ verify: vi.fn(async (request, next) => next(request, {})) });
		expect((await post()).status).toBe(401);
	});
});

describe('originPolicy', () => {
	it('allows loopback origins only in development', () => {
		expect(originPolicy('https://a.test', true)('http://localhost:6274')).toBe(true);
		expect(originPolicy('https://a.test', false)('http://localhost:6274')).toBe(false);
		expect(originPolicy('https://a.test', false)('https://a.test')).toBe(true);
	});
});
