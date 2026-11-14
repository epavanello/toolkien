import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeServer, fakeNetwork, type FakeServer } from './testing/fake-mcp.ts';

let servers: FakeServer[] = [];
vi.mock('#lib/server/net/index.ts', async () => {
	const { UnsafeUrlError } = await import('#lib/server/net/types.ts');
	return {
		UnsafeUrlError,
		safeFetch: (input: string | URL, init?: RequestInit) => fakeNetwork(() => servers)(input, init),
		assertSafeUrl: async (url: string | URL) => new URL(String(url))
	};
});

const { callUpstreamTool, listTools, toScriptValue } = await import('./upstream.ts');

const echo = {
	name: 'echo_text',
	description: 'Echo.',
	inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
	outputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
	annotations: { readOnlyHint: true },
	call: (args: Record<string, unknown>) => ({
		content: [{ type: 'text', text: JSON.stringify({ text: args.text }) }],
		structuredContent: { text: args.text }
	})
};

describe('upstream client', () => {
	beforeEach(() => {
		servers = [];
	});

	it.each([false, true])('lists and calls tools (legacyOnly=%s)', async (legacyOnly) => {
		const server = createFakeServer({
			host: 'a.example',
			tools: [echo],
			legacyOnly,
			listChanged: true
		});
		servers.push(server);
		const { tools, info } = await listTools({ url: server.url, credential: null });
		expect(tools.map((t) => t.name)).toEqual(['echo_text']);
		expect(tools[0].annotations).toEqual({ readOnlyHint: true });
		expect(info.protocolVersion).toBe(legacyOnly ? '2025-11-25' : '2026-07-28');
		expect(info.toolsListChanged).toBe(true);
		const result = await callUpstreamTool({ url: server.url, credential: null }, tools[0], {
			text: 'hi'
		});
		expect(result.ok && toScriptValue(result)).toEqual({ text: 'hi' });
	});

	it('sends the bearer token and maps 401', async () => {
		const server = createFakeServer({
			host: 'b.example',
			tools: [echo],
			auth: { kind: 'token', token: 'secret' }
		});
		servers.push(server);
		await expect(
			listTools({ url: server.url, credential: { token: 'wrong' } })
		).rejects.toMatchObject({
			code: 'auth_required'
		});
		const { tools } = await listTools({ url: server.url, credential: { token: 'secret' } });
		const result = await callUpstreamTool(
			{ url: server.url, credential: { token: 'secret' } },
			tools[0],
			{ text: 'x' }
		);
		expect(result.ok).toBe(true);
		expect(server.calls[0].authorization).toBe('Bearer secret');
		const denied = await callUpstreamTool(
			{ url: server.url, credential: { token: 'nope' } },
			tools[0],
			{ text: 'x' }
		);
		expect(denied).toMatchObject({ ok: false, code: 'auth_required' });
	});

	it('maps unknown tools', async () => {
		const server = createFakeServer({ host: 'c.example', tools: [echo] });
		servers.push(server);
		const result = await callUpstreamTool(
			{ url: server.url, credential: null },
			{ name: 'gone', inputSchema: { type: 'object' }, outputSchema: null },
			{}
		);
		expect(result).toMatchObject({ ok: false, code: 'unknown_tool' });
	});
});
