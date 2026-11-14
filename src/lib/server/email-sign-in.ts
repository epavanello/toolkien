/**
 * Passwordless sign-in by email (also creates the account on first use).
 *
 * 1. `requestEmailSignIn`: rate-limited per email and per IP, then one email with a 6-digit code
 *    and a magic link (`auth.ts` → `magicLink.sendMagicLink`). The answer never says whether an
 *    account exists.
 * 2a. `verifyEmailCode`: the code typed in the same tab, which keeps an MCP OAuth/consent flow
 *    (`redirectTo`) in place.
 * 2b. `confirmMagicLink`: the link opens `/login/confirm`, whose button calls this. A GET never
 *    consumes the token, so corporate link scanners cannot burn it.
 *
 * Better Auth's own HTTP endpoints for these flows are disabled (`SERVER_ONLY_PATHS`).
 */
import { error } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { createHash } from 'node:crypto';
import { safeRedirectPath } from '#lib/core/redirects.ts';
import { auth } from '#lib/server/auth.ts';
import { EmailError, emailConfigured } from '#lib/server/email/index.ts';
import { checkRateLimit } from '#lib/server/limits/index.ts';

const MINUTE = 60_000;
/** Sends per address and per client IP (15-minute windows) */
export const EMAIL_SIGN_IN_LIMITS = { perEmail: 5, perIp: 20, windowMs: 15 * MINUTE } as const;

/** Rate-limit keys never hold the address itself */
const emailKey = (email: string) =>
	`signin:email:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

function rateLimited(retryAfterMs: number): never {
	error(429, `Too many sign-in emails. Try again in ${Math.ceil(retryAfterMs / MINUTE)} min.`, {
		code: 'RATE_LIMITED'
	});
}

export async function requestEmailSignIn(input: {
	email: string;
	redirectTo?: string | null;
	ip: string | null;
	headers: Headers;
}): Promise<void> {
	if (!emailConfigured()) {
		error(503, 'Email sign-in is not configured on this server. Use a passkey.', {
			code: 'UNAVAILABLE'
		});
	}
	const email = normalizeEmail(input.email);
	const { perEmail, perIp, windowMs } = EMAIL_SIGN_IN_LIMITS;
	if (input.ip) {
		const byIp = checkRateLimit(`signin:ip:${input.ip}`, perIp, windowMs);
		if (!byIp.allowed) rateLimited(byIp.retryAfterMs);
	}
	const byEmail = checkRateLimit(emailKey(email), perEmail, windowMs);
	if (!byEmail.allowed) rateLimited(byEmail.retryAfterMs);

	try {
		// Server-only: creates the code without sending it…
		const code = await auth.api.createVerificationOTP({ body: { email, type: 'sign-in' } });
		// …which then travels in the magic-link email (one message, both ways to sign in)
		await auth.api.signInMagicLink({
			body: { email, metadata: { code, redirectTo: safeRedirectPath(input.redirectTo) } },
			headers: input.headers
		});
	} catch (cause) {
		if (cause instanceof EmailError || (isAPIError(cause) && cause.status !== 'BAD_REQUEST')) {
			console.error('[auth] sign-in email failed', cause instanceof EmailError ? cause.status : '');
			error(502, 'The sign-in email could not be sent. Try again in a moment.', {
				code: 'UNAVAILABLE'
			});
		}
		throw cause;
	}
}

/** Signs in with the emailed code (sets the session cookie through `sveltekitCookies`) */
export async function verifyEmailCode(input: { email: string; code: string; headers: Headers }) {
	try {
		return await auth.api.signInEmailOTP({
			body: { email: normalizeEmail(input.email), otp: input.code.trim() },
			headers: input.headers
		});
	} catch (cause) {
		if (isAPIError(cause)) {
			const code = String(cause.body?.code ?? '');
			const message =
				code === 'TOO_MANY_ATTEMPTS'
					? 'Too many wrong codes. Request a new email.'
					: code === 'OTP_EXPIRED'
						? 'This code expired. Request a new email.'
						: 'That code is not valid. Check the latest email.';
			error(400, message, { code: 'INVALID_INPUT' });
		}
		throw cause;
	}
}

/** Consumes a magic-link token (single use) and signs in */
export async function confirmMagicLink(input: { token: string; headers: Headers }) {
	try {
		return await auth.api.magicLinkVerify({
			query: { token: input.token },
			headers: input.headers
		});
	} catch (cause) {
		// Invalid or used tokens redirect with `?error=INVALID_TOKEN` inside Better Auth
		if (isAPIError(cause) || (cause as { status?: number })?.status === 302) {
			error(400, 'This sign-in link is invalid or was already used. Request a new one.', {
				code: 'INVALID_INPUT'
			});
		}
		throw cause;
	}
}
