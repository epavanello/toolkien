/**
 * Machine-readable codes carried by `App.Error` (`error(status, message, { code })`).
 * The UI branches on the code, never on the message. Shared by client and server.
 */
export const ERROR_CODES = [
	'GENERIC',
	'UNAUTHORIZED',
	'FORBIDDEN',
	'NOT_FOUND',
	'INVALID_INPUT',
	'CONFLICT',
	'RATE_LIMITED',
	'SUSPENDED',
	'POLICY_DENIED',
	/** Owners/admins of company workspaces need a registered passkey (UI links to the account page) */
	'SECOND_FACTOR_REQUIRED',
	/** A dependency (email transport, runner) is not configured or not reachable */
	'UNAVAILABLE',
	'NOT_IMPLEMENTED'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const isErrorCode = (value: unknown): value is ErrorCode =>
	typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
