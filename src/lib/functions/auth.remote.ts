import { command, form, getRequestEvent, query } from '$app/server';
import { invalid, isHttpError, redirect, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { safeRedirectPath } from '#lib/core/redirects.ts';
import { auth } from '#lib/server/auth.ts';
import {
	confirmMagicLink,
	normalizeEmail,
	requestEmailSignIn,
	verifyEmailCode
} from '#lib/server/email-sign-in.ts';

/** Client IP for rate limits; adapter-node throws when `ADDRESS_HEADER` is set but missing */
function clientAddress(event: RequestEvent) {
	try {
		return event.getClientAddress();
	} catch {
		return null;
	}
}

const email = z.email({ error: 'Enter a valid email address.' });
const redirectTo = z.string().optional();

/** Turns an `error(4xx, message)` from the sign-in service into a form-level issue */
async function asFormIssue<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (cause) {
		// 4xx (wrong code, rate limit) and 503/502 (email not configured or unreachable) all
		// carry a user-facing message
		if (isHttpError(cause)) invalid(cause.body.message);
		throw cause;
	}
}

/** Step 1: emails a 6-digit code and a magic link (signs up on first use) */
export const requestSignIn = form(
	z.object({ email, redirectTo }),
	async ({ email, redirectTo }) => {
		const event = getRequestEvent();
		await asFormIssue(() =>
			requestEmailSignIn({
				email,
				redirectTo,
				ip: clientAddress(event),
				headers: event.request.headers
			})
		);
		return { email: normalizeEmail(email) };
	}
);

/** Step 2 (same tab): the emailed code; keeps `redirectTo` (MCP consent) in place */
export const verifySignInCode = form(
	z.object({
		email,
		code: z
			.string()
			.trim()
			.regex(/^\d{6}$/, { error: 'Enter the 6-digit code.' }),
		redirectTo
	}),
	async ({ email, code, redirectTo }) => {
		const { request } = getRequestEvent();
		await asFormIssue(() => verifyEmailCode({ email, code, headers: request.headers }));
		redirect(303, safeRedirectPath(redirectTo));
	}
);

/** The magic link's confirm button: consumes the token on click, never on page load */
export const confirmSignIn = command(
	z.object({ token: z.string().min(16).max(200), redirectTo }),
	async ({ token, redirectTo }) => {
		const { request } = getRequestEvent();
		await confirmMagicLink({ token, headers: request.headers });
		return { redirectTo: safeRedirectPath(redirectTo) };
	}
);

export const signOut = command(async () => {
	const { request } = getRequestEvent();
	await auth.api.signOut({ headers: request.headers });
});

/** The signed-in user as the client may see it (no internal fields) */
export const getCurrentUser = query(async () => {
	const { locals } = getRequestEvent();
	if (!locals.user) return null;
	const { id, name, email, image } = locals.user;
	return { id, name, email, image: image ?? null };
});
