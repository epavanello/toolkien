import { describe, expect, it } from 'vitest';
import { isBearerOnlyPath, isCrossSiteFormRequest, securityHeaders } from './security.ts';

const origin = 'https://toolkien.test';
const post = (path: string, headers: Record<string, string>) =>
	[
		new Request(`${origin}${path}`, { method: 'POST', headers }),
		new URL(`${origin}${path}`)
	] as const;
const form = { 'content-type': 'application/x-www-form-urlencoded' };

describe('isCrossSiteFormRequest', () => {
	it('blocks form posts from other or missing origins', () => {
		expect(
			isCrossSiteFormRequest(...post('/login', { ...form, origin: 'https://evil.test' }))
		).toBe(true);
		expect(isCrossSiteFormRequest(...post('/login', form))).toBe(true);
	});

	it('allows same-origin forms, JSON and the OAuth endpoints', () => {
		expect(isCrossSiteFormRequest(...post('/login', { ...form, origin }))).toBe(false);
		expect(isCrossSiteFormRequest(...post('/x', { 'content-type': 'application/json' }))).toBe(
			false
		);
		expect(isCrossSiteFormRequest(...post('/api/auth/oauth2/token', form))).toBe(false);
		expect(isCrossSiteFormRequest(...post('/api/auth/oauth2/authorize', form))).toBe(true);
	});
});

describe('security headers', () => {
	it('adds HSTS only in production', () => {
		expect(securityHeaders({ production: true })['Strict-Transport-Security']).toBeDefined();
		expect(securityHeaders({ production: false })['Strict-Transport-Security']).toBeUndefined();
		expect(securityHeaders({ production: false })['X-Frame-Options']).toBe('DENY');
	});

	it('treats only /mcp as bearer-only', () => {
		expect(isBearerOnlyPath('/mcp')).toBe(true);
		expect(isBearerOnlyPath('/mcp/x')).toBe(true);
		expect(isBearerOnlyPath('/mcpx')).toBe(false);
	});
});
