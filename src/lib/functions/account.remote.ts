import { command, form, getRequestEvent, query } from '$app/server';
import { error, invalid, redirect } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { deleteAccount, deletionBlockers } from '#lib/server/account/index.ts';
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
			.select({ createdAt: userTable.createdAt })
			.from(userTable)
			.where(eq(userTable.id, user.id))
			.limit(1),
		listPasskeys(user.id),
		deletionBlockers(user.id),
		needsSecondFactor(user.id)
	]);
	return {
		user: { id: user.id, name: user.name, email: user.email, createdAt: row?.createdAt ?? null },
		passkeys,
		secondFactorRequired: required,
		deletionBlockers: blockers
	};
});

export const removePasskey = command(z.string().min(1).max(200), async (id) => {
	const user = requireUser();
	const passkeys = await listPasskeys(user.id);
	if (passkeys.length === 1 && (await needsSecondFactor(user.id))) {
		error(400, 'Keep at least one passkey: you own or administer a company workspace.', {
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
