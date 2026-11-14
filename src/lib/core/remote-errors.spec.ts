import { error } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { UNEXPECTED_ERROR, remoteErrorMessage } from './remote-errors.ts';

const thrown = (status: number, message: string) => {
	try {
		error(status, message, { code: 'GENERIC' });
	} catch (e) {
		return e;
	}
};

describe('remoteErrorMessage', () => {
	it('shows 4xx messages, hides 5xx and unknown errors', () => {
		expect(remoteErrorMessage(thrown(403, 'Not allowed.'))).toBe('Not allowed.');
		expect(remoteErrorMessage({ status: 404, message: 'Missing.' })).toBe('Missing.');
		expect(remoteErrorMessage(thrown(500, 'db exploded'))).toBe(UNEXPECTED_ERROR);
		expect(remoteErrorMessage(new Error('boom'))).toBe(UNEXPECTED_ERROR);
	});
});
