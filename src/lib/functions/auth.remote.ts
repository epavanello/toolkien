import { command, form, getRequestEvent, query } from '$app/server';
import { invalid, redirect } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { z } from 'zod';
import { safeRedirectPath } from '#lib/core/redirects.ts';
import { auth } from '#lib/server/auth.ts';

const email = z.email({ error: 'Enter a valid email address.' });
const password = z.string().min(12, { error: 'Use at least 12 characters.' });
const requiredPassword = z.string().min(1, { error: 'Enter your password.' });
const name = z.string().trim().min(1, { error: 'Enter your name.' }).max(100);
const redirectTo = z.string().optional();

/** Better Auth error codes we can explain; anything else gets the generic message */
const AUTH_ERRORS: Record<string, string> = {
	INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
	USER_ALREADY_EXISTS: 'An account with this email already exists.',
	USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'An account with this email already exists.',
	PASSWORD_TOO_SHORT: 'Use at least 12 characters.',
	INVALID_CODE: 'That code is not valid. Try again.',
	INVALID_TWO_FACTOR_COOKIE: 'The sign-in expired. Start again.'
};

/** Runs a Better Auth call and turns its failure into a form issue the user can act on */
async function authCall<T>(call: () => Promise<T>): Promise<T> {
	try {
		return await call();
	} catch (cause) {
		const code = isAPIError(cause) ? String(cause.body?.code ?? '') : '';
		if (!AUTH_ERRORS[code]) console.error('[auth] unexpected sign-in error', code || cause);
		invalid(AUTH_ERRORS[code] ?? 'Something went wrong. Please try again.');
	}
}

export const login = form(
	z.object({ email, password: requiredPassword, redirectTo }),
	async ({ email, password, redirectTo }) => {
		const { request } = getRequestEvent();
		const result = await authCall(() =>
			auth.api.signInEmail({ body: { email, password }, headers: request.headers })
		);
		const next = safeRedirectPath(redirectTo);
		if ('twoFactorRedirect' in result && result.twoFactorRedirect) {
			redirect(303, `/two-factor?redirectTo=${encodeURIComponent(next)}`);
		}
		redirect(303, next);
	}
);

export const signup = form(
	z.object({ name, email, password, redirectTo }),
	async ({ name, email, password, redirectTo }) => {
		const { request } = getRequestEvent();
		await authCall(() =>
			auth.api.signUpEmail({ body: { name, email, password }, headers: request.headers })
		);
		redirect(303, safeRedirectPath(redirectTo));
	}
);

export const verifyTwoFactor = form(
	z.object({
		code: z
			.string()
			.trim()
			.regex(/^\d{6}$/, { error: 'Enter the 6-digit code.' }),
		redirectTo
	}),
	async ({ code, redirectTo }) => {
		const { request } = getRequestEvent();
		await authCall(() => auth.api.verifyTOTP({ body: { code }, headers: request.headers }));
		redirect(303, safeRedirectPath(redirectTo));
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
	const { id, name, email, image, twoFactorEnabled } = locals.user;
	return { id, name, email, image: image ?? null, twoFactorEnabled: !!twoFactorEnabled };
});
