import type { HandleClientError } from '@sveltejs/kit/hooks';
import { isErrorCode } from '#lib/core/errors.ts';

/**
 * Errors raised while navigating in the browser (universal loads, failed fetches of route data).
 * A navigation that fails because the device is offline becomes a 503 `UNAVAILABLE`, which the
 * error page shows as "You are offline". Unknown errors keep a generic message.
 */
export const handleError: HandleClientError = ({ kind, error }) => {
	if (kind === 'app') return { ...error, code: isErrorCode(error.code) ? error.code : 'GENERIC' };
	if (typeof navigator !== 'undefined' && !navigator.onLine) {
		return { status: 503, code: 'UNAVAILABLE', message: 'You are offline.' };
	}
	if (kind === 'framework') {
		return { code: error.status === 404 ? 'NOT_FOUND' : 'GENERIC', message: error.message };
	}
	console.error(error);
	return { code: 'GENERIC', message: 'Internal error' };
};
