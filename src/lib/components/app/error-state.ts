import type { ErrorCode } from '#lib/core/errors.ts';

/** Which illustration-free icon and actions an error page shows */
export type ErrorKind =
	| 'offline'
	| 'not_found'
	| 'forbidden'
	| 'unauthorized'
	| 'suspended'
	| 'invalid'
	| 'rate_limited'
	| 'unavailable'
	| 'server';

export type ErrorDescription = {
	kind: ErrorKind;
	title: string;
	description: string;
	/** The app's own 4xx message, when it says more than the generic copy (never for 5xx) */
	detail?: string;
	/** Offer "Try again" (transient errors) */
	retry: boolean;
	/** Offer "Sign in" */
	signIn: boolean;
};

export type ErrorInput = {
	status: number;
	code?: ErrorCode | string;
	message?: string;
	/** `navigator.onLine` on the client; omit on the server */
	online?: boolean;
};

const COPY: Record<ErrorKind, Pick<ErrorDescription, 'title' | 'description'>> = {
	offline: {
		title: 'You are offline',
		description: 'Check your connection, then try again. Nothing you did was lost.'
	},
	not_found: {
		title: 'Page not found',
		description: 'This page does not exist or has moved. Check the address, or start from home.'
	},
	forbidden: {
		title: 'You do not have access',
		description: 'Your account cannot open this page. Ask a workspace owner or admin for access.'
	},
	unauthorized: {
		title: 'Sign in to continue',
		description: 'This page needs an account. Sign in and you will come back here.'
	},
	suspended: {
		title: 'Access suspended',
		description: 'This account or workspace is suspended. Contact its owner or support.'
	},
	invalid: {
		title: 'This request is not valid',
		description: 'Something in the address or the form is not right. Go back and try again.'
	},
	rate_limited: {
		title: 'Too many requests',
		description: 'You are going a little fast. Wait a moment, then try again.'
	},
	unavailable: {
		title: 'Temporarily unavailable',
		description: 'A service Toolkien depends on is not reachable right now. Try again shortly.'
	},
	server: {
		title: 'Something went wrong',
		description:
			'An unexpected error happened on our side. Try again; if it keeps happening, report it with the reference below.'
	}
};

/** Reason phrases and default framework messages: they say nothing beyond the status */
const GENERIC_MESSAGES = new Set([
	'',
	'not found',
	'forbidden',
	'unauthorized',
	'bad request',
	'method not allowed',
	'internal error',
	'internal server error',
	'too many requests',
	'service unavailable',
	'invalid input',
	'error'
]);

const normalize = (message: string) =>
	message
		.trim()
		.toLowerCase()
		.replace(/[.!]+$/, '');

function kindOf({ status, code, online }: ErrorInput): ErrorKind {
	if (online === false) return 'offline';
	if (code === 'SUSPENDED') return 'suspended';
	if (code === 'RATE_LIMITED' || status === 429) return 'rate_limited';
	if (status === 401 || code === 'UNAUTHORIZED') return 'unauthorized';
	if (status === 403 || code === 'FORBIDDEN' || code === 'POLICY_DENIED') return 'forbidden';
	if (status === 404 || status === 410 || code === 'NOT_FOUND') return 'not_found';
	if (status === 503 || code === 'UNAVAILABLE') return 'unavailable';
	if (status >= 400 && status < 500) return 'invalid';
	return 'server';
}

/**
 * Pure: status + code (+ connectivity) → the copy of an error page. 4xx messages from `error()`
 * are user-facing by convention and shown as a detail; 5xx messages never are.
 */
export function describeError(input: ErrorInput): ErrorDescription {
	const kind = kindOf(input);
	const message = input.message?.trim() ?? '';
	const detail =
		input.status < 500 && kind !== 'offline' && !GENERIC_MESSAGES.has(normalize(message))
			? message
			: undefined;
	return {
		kind,
		...COPY[kind],
		...(detail ? { detail } : {}),
		retry: ['offline', 'rate_limited', 'unavailable', 'server'].includes(kind),
		signIn: kind === 'unauthorized'
	};
}
