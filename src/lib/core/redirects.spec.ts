import { describe, expect, it } from 'vitest';
import { safeRedirectPath } from './redirects.ts';

describe('safeRedirectPath', () => {
	it('keeps same-origin paths with query and hash', () => {
		expect(safeRedirectPath('/w/acme/connectors?x=1#top')).toBe('/w/acme/connectors?x=1#top');
	});

	it.each([
		'https://evil.example/',
		'//evil.example',
		'/\\evil.example',
		'javascript:alert(1)',
		'w/acme',
		'',
		null,
		undefined
	])('rejects %s', (target) => {
		expect(safeRedirectPath(target, '/fallback')).toBe('/fallback');
	});
});
