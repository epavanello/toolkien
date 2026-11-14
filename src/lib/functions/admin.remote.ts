import { command, form, query } from '$app/server';
import { error, invalid } from '@sveltejs/kit';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '#lib/server/db/index.ts';
import { organization, user as userTable } from '#lib/server/db/schema/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import { listJobs, runJob } from '#lib/server/jobs/index.ts';
import {
	activateKillSwitch,
	concurrencySnapshot,
	defaultLimits,
	getExtendedLimits,
	isPlatformAdminEmail,
	LIMIT_FIELDS,
	listKillSwitches,
	releaseKillSwitch,
	updateLimits,
	usageByWorkspace,
	utcDay
} from '#lib/server/limits/index.ts';
import type { LimitKey } from '#lib/server/limits/types.ts';
import { hasSecondFactor } from '#lib/server/workspaces/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Platform admins (`PLATFORM_ADMIN_EMAILS`); everyone else gets a 404 */
function requirePlatformAdmin() {
	const user = requireUser();
	if (!isPlatformAdminEmail(user.email)) error(404, 'Not found.', { code: 'NOT_FOUND' });
	return user;
}

/** Changes need the admin's second factor too */
async function requirePlatformAdminAction() {
	const user = requirePlatformAdmin();
	if (!(await hasSecondFactor(user.id))) {
		error(403, 'Add a passkey to change platform settings.', {
			code: 'SECOND_FACTOR_REQUIRED'
		});
	}
	return user;
}

export const getPlatformOverview = query(async () => {
	const admin = requirePlatformAdmin();
	const to = new Date();
	const [limits, switches, usage, [users], [workspaces], secondFactor] = await Promise.all([
		getExtendedLimits(),
		listKillSwitches({ limit: 50 }),
		usageByWorkspace(utcDay(new Date(to.getTime() - 29 * DAY_MS)), utcDay(to)),
		db.select({ value: count() }).from(userTable),
		db.select({ value: count() }).from(organization),
		hasSecondFactor(admin.id)
	]);
	return {
		limits,
		defaults: defaultLimits(),
		fields: LIMIT_FIELDS,
		switches,
		platformSwitch: switches.find((s) => s.scope === 'platform' && !s.releasedAt) ?? null,
		usage: usage.map((row) => ({ ...row, name: row.name ?? '(deleted)' })),
		concurrency: concurrencySnapshot(),
		jobs: listJobs(),
		totals: { users: users.value, workspaces: workspaces.value },
		secondFactor
	};
});

const limitShape = Object.fromEntries(
	Object.entries(LIMIT_FIELDS).map(([key, field]) => [
		key,
		z
			.number({ error: `${field.label}: enter a number.` })
			.int()
			.min(field.min, { error: `${field.label}: at least ${field.min}.` })
			.max(field.max, { error: `${field.label}: at most ${field.max}.` })
	])
) as Record<LimitKey, z.ZodNumber>;

export const updatePlatformLimits = form(z.object(limitShape), async (values) => {
	const admin = await requirePlatformAdminAction();
	await updateLimits(admin.id, values);
	void getPlatformOverview().refresh();
});

const reason = z.string().trim().min(3, { error: 'Give a short reason.' }).max(500);

export const pausePlatform = form(z.object({ reason }), async ({ reason }) => {
	const admin = await requirePlatformAdminAction();
	await activateKillSwitch({
		scope: 'platform',
		reason,
		origin: 'platform_admin',
		actorUserId: admin.id
	});
	void getPlatformOverview().refresh();
});

export const suspendUser = form(
	z.object({ email: z.email({ error: 'Enter a valid email address.' }), reason }),
	async ({ email, reason }) => {
		const admin = await requirePlatformAdminAction();
		const [target] = await db
			.select({ id: userTable.id, email: userTable.email })
			.from(userTable)
			.where(eq(userTable.email, email.toLowerCase()))
			.limit(1);
		if (!target) invalid('No account with this email.');
		if (isPlatformAdminEmail(target.email)) invalid('Platform admins cannot be suspended here.');
		await activateKillSwitch({
			scope: 'user',
			targetId: target.id,
			reason,
			origin: 'platform_admin',
			actorUserId: admin.id
		});
		void getPlatformOverview().refresh();
	}
);

export const suspendWorkspaceBySlug = form(
	z.object({
		slug: z.string().trim().min(1, { error: 'Enter the workspace slug.' }).max(100),
		reason
	}),
	async ({ slug, reason }) => {
		const admin = await requirePlatformAdminAction();
		const [target] = await db
			.select({ id: organization.id })
			.from(organization)
			.where(eq(organization.slug, slug))
			.limit(1);
		if (!target) invalid('No workspace with this slug.');
		await activateKillSwitch({
			scope: 'workspace',
			targetId: target.id,
			reason,
			origin: 'platform_admin',
			actorUserId: admin.id
		});
		void getPlatformOverview().refresh();
	}
);

export const releaseSwitch = command(z.string().min(1).max(100), async (id) => {
	const admin = await requirePlatformAdminAction();
	await releaseKillSwitch({ id, actorUserId: admin.id, asPlatformAdmin: true });
	void getPlatformOverview().refresh();
});

export const runJobNow = command(z.string().min(1).max(100), async (name) => {
	await requirePlatformAdminAction();
	if (!listJobs().some((job) => job.name === name))
		error(404, 'Unknown job.', { code: 'NOT_FOUND' });
	await runJob(name);
	void getPlatformOverview().refresh();
});
