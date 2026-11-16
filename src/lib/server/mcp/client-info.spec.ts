import { describe, expect, it } from 'vitest';
import { cleanPart, formatClientInfo, peekClientInfo } from './client-info.ts';

const request = (body: unknown, type = 'application/json') =>
	new Request('https://toolkien.test/mcp', {
		method: 'POST',
		headers: { 'content-type': type },
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});

describe('MCP client info', () => {
	it('formats name and version, sanitized and capped', () => {
		expect(formatClientInfo({ name: 'claude-code', version: '2.1.3' })).toBe('claude-code 2.1.3');
		expect(formatClientInfo({ name: 'codex', title: 'Codex' })).toBe('codex');
		expect(formatClientInfo({ name: 'evil\u0000\u001b[31m\nname', version: '1' })).toBe(
			'evil [31m name 1'
		);
		expect(formatClientInfo({ name: '   ' })).toBeNull();
		expect(formatClientInfo('claude')).toBeNull();
		expect(cleanPart('x'.repeat(200))).toHaveLength(60);
	});

	it('reads the 2026-07-28 envelope and the 2025 initialize, nothing else', async () => {
		expect(
			await peekClientInfo(
				request({
					jsonrpc: '2.0',
					id: 1,
					method: 'tools/call',
					params: { _meta: { 'io.modelcontextprotocol/clientInfo': { name: 'a', version: '1' } } }
				})
			)
		).toEqual({ info: 'a 1', fromInitialize: false });
		expect(
			await peekClientInfo(
				request({
					jsonrpc: '2.0',
					id: 0,
					method: 'initialize',
					params: { clientInfo: { name: 'b', version: '2' } }
				})
			)
		).toEqual({ info: 'b 2', fromInitialize: true });
		const none = { info: null, fromInitialize: false };
		expect(await peekClientInfo(request({ jsonrpc: '2.0', id: 1, method: 'tools/list' }))).toEqual(
			none
		);
		expect(await peekClientInfo(request('not json'))).toEqual(none);
		expect(await peekClientInfo(request([{ method: 'initialize' }]))).toEqual(none);
		expect(
			await peekClientInfo(
				request({ method: 'initialize', params: { clientInfo: { name: 'c' } } }, 'text/plain')
			)
		).toEqual(none);
	});

	it('leaves the request body readable', async () => {
		const original = request({ method: 'initialize', params: { clientInfo: { name: 'd' } } });
		await peekClientInfo(original);
		expect(JSON.parse(await original.text()).method).toBe('initialize');
	});
});
