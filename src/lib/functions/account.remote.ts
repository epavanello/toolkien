import { command, form, getRequestEvent, query } from '$app/server';
import { error, invalid, redirect } from '@sveltejs/kit';
import { isAPIError } from 'better-auth/api';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { deleteAccount, deletionBlockers } from '#lib/server/account/index.ts';
import { auth } from '#lib/server/auth.ts';
import { db } from '#lib/server/db/index.ts';
import { passkey, user as userTable } from '#lib/server/db/schema/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { listForUser, requiresSecondFactor } from '#lib/server/workspaces/index.ts';

/** Sensitive account actions need a sign-in from the last 24 hours */
const FRESH_SESSION_MS = 24 * 60 * 60 * 1000;

async function listPasskeys(userId: string) {
	return db
		.select({
			id: passkey.id,
			name: passkey.name,
			deviceType: passkey.deviceType,
			createdAt: passkey.createdAt
		})
		.from(passkey)
		.where(eq(passkey.userId, userId))
		.orderBy(asc(passkey.createdAt));
}

/** Whether the user is owner/admin of a company workspace (then a second factor is mandatory) */
async function needsSecondFactor(userId: string) {
	return (await listForUser(userId)).some(requiresSecondFactor);
}

export const getAccount = query(async () => {
	const user = requireUser();
	const [[row], passkeys, blockers, required] = await Promise.all([
		db
			.select({ twoFactorEnabled: userTable.twoFactorEnabled, createdAt: userTable.createdAt })
			.from(userTable)
			.where(eq(userTable.id, user.id))
			.limit(1),
		listPasskeys(user.id),
		deletionBlockers(user.id),
		needsSecondFactor(user.id)
	]);
	return {
		user: { id: user.id, name: user.name, email: user.email, createdAt: row?.createdAt ?? null },
		twoFactorEnabled: !!row?.twoFactorEnabled,
		passkeys,
		secondFactorRequired: required,
		deletionBlockers: blockers
	};
});

/** Better Auth errors we can explain on the security forms */
function authFailure(cause: unknown): never {
	const code = isAPIError(cause) ? String(cause.body?.code ?? '') : '';
	const messages: Record<string, string> = {
		INVALID_PASSWORD: 'Wrong password.',
		INVALID_CODE: 'That code is not valid. Try again.',
		CREDENTIAL_ACCOUNT_NOT_FOUND: 'This account has no password: use a passkey instead.'
	};
	invalid(messages[code] ?? 'Something went wrong. Please try again.');
}

/** Step 1 of TOTP setup: returns the secret to add to an authenticator app, and backup codes */
export const startTwoFactorSetup = form(
	z.object({ password: z.string().min(1, { error: 'Enter your password.' }) }),
	async ({ password }) => {
		requireUser();
		const { request } = getRequestEvent();
		try {
			const result = await auth.api.enableTwoFactor({
				body: { password },
				headers: request.headers
			});
			if (!('totpURI' in result)) invalid('Two-factor setup is not available.');
			const secret = new URL(result.totpURI).searchParams.get('secret') ?? '';
			return { totpURI: result.totpURI, secret, backupCodes: result.backupCodes };
		} catch (cause) {
			authFailure(cause);
		}
	}
);

/** Step 2: the first code from the app turns 2FA on */
export const confirmTwoFactorSetup = form(
	z.object({
		code: z
			.string()
			.trim()
			.regex(/^\d{6}$/, { error: 'Enter the 6-digit code.' })
	}),
	async ({ code }) => {
		requireUser();
		const { request } = getRequestEvent();
		try {
			await auth.api.verifyTOTP({ body: { code }, headers: request.headers });
		} catch (cause) {
			authFailure(cause);
		}
		void getAccount().refresh();
	}
);

export const disableTwoFactor = form(
	z.object({ password: z.string().min(1, { error: 'Enter your password.' }) }),
	async ({ password }) => {
		const user = requireUser();
		if ((await needsSecondFactor(user.id)) && (await listPasskeys(user.id)).length === 0) {
			invalid('Add a passkey first: admins of company workspaces need a second factor.');
		}
		const { request } = getRequestEvent();
		try {
			await auth.api.disableTwoFactor({ body: { password }, headers: request.headers });
		} catch (cause) {
			authFailure(cause);
		}
		void getAccount().refresh();
	}
);

export const removePasskey = command(z.string().min(1).max(200), async (id) => {
	const user = requireUser();
	const passkeys = await listPasskeys(user.id);
	const [row] = await db
		.select({ twoFactorEnabled: userTable.twoFactorEnabled })
		.from(userTable)
		.where(eq(userTable.id, user.id));
	if (passkeys.length === 1 && !row?.twoFactorEnabled && (await needsSecondFactor(user.id))) {
		error(400, 'Keep at least one passkey or enable 2FA: you administer a company workspace.', {
			code: 'INVALID_INPUT'
		});
	}
	await db.delete(passkey).where(and(eq(passkey.id, id), eq(passkey.userId, user.id)));
	void getAccount().refresh();
});

export const deleteMyAccount = form(
	z.object({ confirmEmail: z.string().trim().min(1, { error: 'Type your email address.' }) }),
	async ({ confirmEmail }) => {
		const user = requireUser();
		const { locals } = getRequestEvent();
		if (confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
			invalid('The email does not match your account.');
		}
		const signedInAt = locals.session?.createdAt?.getTime() ?? 0;
		if (Date.now() - signedInAt > FRESH_SESSION_MS) {
			invalid('For your safety, sign out and sign in again before deleting your account.');
		}
		await deleteAccount(user.id);
		redirect(303, '/');
	}
);
