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
	/** Owners/admins of company workspaces need 2FA or a passkey (UI links to account security) */
	'SECOND_FACTOR_REQUIRED',
	'NOT_IMPLEMENTED'
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const isErrorCode = (value: unknown): value is ErrorCode =>
	typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
