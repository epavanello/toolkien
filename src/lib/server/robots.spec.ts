import { describe, expect, it } from 'vitest';
import { isMachinePath, isPrivatePath, robotsTag } from './robots.ts';

describe('robots', () => {
	it('recognises JSON-only surfaces', () => {
		expect(isMachinePath('/mcp')).toBe(true);
		expect(isMachinePath('/mcp/x')).toBe(true);
		expect(isMachinePath('/api/auth/oauth2/token')).toBe(true);
		expect(isMachinePath('/.well-known/oauth-protected-resource')).toBe(true);
		expect(isMachinePath('/mcpx')).toBe(false);
		expect(isMachinePath('/docs')).toBe(false);
	});

	it('keeps app surfaces out of the index', () => {
		expect(isPrivatePath('/w/acme/connectors')).toBe(true);
		expect(isPrivatePath('/approve/123')).toBe(true);
		expect(isPrivatePath('/login/confirm')).toBe(true);
		expect(isPrivatePath('/login')).toBe(false);
		expect(isPrivatePath('/docs/security')).toBe(false);
		expect(isPrivatePath('/')).toBe(false);
	});

	it('noindexes private paths and error responses only', () => {
		expect(robotsTag('/docs', 200)).toBeNull();
		expect(robotsTag('/docs/nope', 404)).toBe('noindex, nofollow');
		expect(robotsTag('/w/acme', 200)).toBe('noindex, nofollow');
	});
});
