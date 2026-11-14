import { describe, expect, it } from 'vitest';
import { describeError } from './error-state.ts';

describe('describeError', () => {
	it('maps statuses and codes to kinds', () => {
		expect(describeError({ status: 404 }).kind).toBe('not_found');
		expect(describeError({ status: 403 }).kind).toBe('forbidden');
		expect(describeError({ status: 403, code: 'POLICY_DENIED' }).kind).toBe('forbidden');
		expect(describeError({ status: 401 }).kind).toBe('unauthorized');
		expect(describeError({ status: 403, code: 'SUSPENDED' }).kind).toBe('suspended');
		expect(describeError({ status: 429 }).kind).toBe('rate_limited');
		expect(describeError({ status: 400 }).kind).toBe('invalid');
		expect(describeError({ status: 503 }).kind).toBe('unavailable');
		expect(describeError({ status: 500 }).kind).toBe('server');
	});

	it('reports offline first, whatever the status', () => {
		const info = describeError({ status: 500, online: false });
		expect(info.kind).toBe('offline');
		expect(info.retry).toBe(true);
	});

	it('shows a meaningful 4xx message as detail', () => {
		const info = describeError({ status: 404, code: 'NOT_FOUND', message: 'Workspace not found.' });
		expect(info.detail).toBe('Workspace not found.');
	});

	it('hides generic reason phrases', () => {
		expect(describeError({ status: 404, message: 'Not Found' }).detail).toBeUndefined();
		expect(describeError({ status: 404, message: 'Not found.' }).detail).toBeUndefined();
		expect(describeError({ status: 403, message: 'Forbidden' }).detail).toBeUndefined();
	});

	it('never shows 5xx messages', () => {
		const info = describeError({ status: 500, message: 'SQLITE_ERROR: no such table: user' });
		expect(info.detail).toBeUndefined();
		expect(info.title).toBe('Something went wrong');
	});

	it('offers sign-in only when unauthenticated and retry only when transient', () => {
		expect(describeError({ status: 401 }).signIn).toBe(true);
		expect(describeError({ status: 404 }).signIn).toBe(false);
		expect(describeError({ status: 404 }).retry).toBe(false);
		expect(describeError({ status: 429 }).retry).toBe(true);
	});
});
