import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({
	PLAUSIBLE_URL: 'https://plausible.example.com',
	PLAUSIBLE_DOMAIN: 'toolkien.example.com'
}));

const { buildEvent, sanitizePageUrl, sanitizeReferrer } = await import('./analytics.ts');
const ORIGIN = 'https://toolkien.example.com';

describe('analytics sanitization', () => {
	it('redacts identifiers and drops every query parameter but campaign ones', () => {
		expect(sanitizePageUrl(`${ORIGIN}/w/personal-abc123/connectors?panel=x`, ORIGIN)).toBe(
			`${ORIGIN}/w/:workspace/connectors`
		);
		expect(sanitizePageUrl(`${ORIGIN}/login/confirm?token=secret&redirectTo=/w/a`, ORIGIN)).toBe(
			`${ORIGIN}/login/confirm`
		);
		expect(sanitizePageUrl(`${ORIGIN}/invite/tok_123`, ORIGIN)).toBe(`${ORIGIN}/invite/:token`);
		expect(sanitizePageUrl(`${ORIGIN}/approve/ap_1?x=1`, ORIGIN)).toBe(`${ORIGIN}/approve/:id`);
		expect(sanitizePageUrl(`${ORIGIN}/connectors/oauth/callback?code=c&state=s`, ORIGIN)).toBe(
			`${ORIGIN}/connectors/:callback`
		);
		expect(sanitizePageUrl(`${ORIGIN}/docs/security/?utm_source=hn&foo=1`, ORIGIN)).toBe(
			`${ORIGIN}/docs/security?utm_source=hn`
		);
	});

	it('rejects foreign or malformed URLs and keeps only external referrer origins', () => {
		expect(sanitizePageUrl('https://evil.example/w/x', ORIGIN)).toBeNull();
		expect(sanitizePageUrl('not a url', ORIGIN)).toBeNull();
		expect(sanitizeReferrer(`${ORIGIN}/w/x?token=1`, ORIGIN)).toBeNull();
		expect(sanitizeReferrer('https://news.ycombinator.com/item?id=1', ORIGIN)).toBe(
			'https://news.ycombinator.com/'
		);
	});

	it('forwards pageviews and outbound clicks only, with the configured domain', () => {
		expect(buildEvent({ n: 'pageview', u: `${ORIGIN}/w/abc`, d: 'other.com' }, ORIGIN)).toEqual({
			n: 'pageview',
			u: `${ORIGIN}/w/:workspace`,
			d: 'toolkien.example.com',
			r: null
		});
		expect(buildEvent({ n: 'Signup', u: `${ORIGIN}/` }, ORIGIN)).toBeNull();
		expect(
			buildEvent(
				{ n: 'Outbound Link: Click', u: `${ORIGIN}/`, p: { url: 'https://github.com/a/b?x=1' } },
				ORIGIN
			)
		).toMatchObject({ p: { url: 'https://github.com/' } });
	});
});
