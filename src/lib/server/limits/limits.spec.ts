import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.ts', async () => {
	const { createTestDb } = await import('#lib/server/workspaces/test-db.ts');
	return { db: await createTestDb() };
});
// The admin list comes from the environment: pin it so the developer's `.env` can't change results
vi.mock('#lib/server/limits/admins.ts', () => ({
	isPlatformAdminEmail: (email: string | null | undefined) =>
		email?.trim().toLowerCase() === 'admin@example.com'
}));
vi.mock('#lib/server/executions/index.ts', () => ({
	cancel: vi.fn(async () => {}),
	abortRunning: vi.fn(() => 0)
}));

import { eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import {
	connector,
	execution,
	oauthAccessToken,
	oauthClient,
	organization,
	session,
	user
} from '#lib/server/db/schema/index.ts';
import * as executions from '#lib/server/executions/index.ts';
import { createWorkspace } from '#lib/server/workspaces/index.ts';
import { seedUser } from '#lib/server/workspaces/test-db.ts';
import {
	activateKillSwitch,
	assertNotSuspended,
	checkExecutionRateLimits,
	defaultLimits,
	getUsage,
	listKillSwitches,
	mergeLimits,
	onKillSwitch,
	recordUsage,
	releaseKillSwitch,
	resetRateLimits,
	SlotPool,
	sumUsage,
	updateLimits,
	getLimits
} from './index.ts';

const codeOf = (promise: Promise<unknown>) =>
	promise.then(
		() => 'resolved',
		(e: { body?: { code?: string } }) => e.body?.code ?? 'unknown'
	);

async function seedConnector(workspaceId: string, ownerUserId: string | null) {
	const [row] = await db
		.insert(connector)
		.values({
			workspaceId,
			ownerUserId,
			scope: 'shared',
			source: 'url',
			url: 'https://mcp.example.com',
			name: 'Example',
			namespace: `ex${crypto.randomUUID().slice(0, 6)}`,
			authType: 'none'
		})
		.returning();
	return row;
}

describe('kill switches', () => {
	it('user switch: suspends, revokes sessions and tokens, cancels executions, then releases', async () => {
		const target = await seedUser(db);
		const admin = await seedUser(db);
		await db.insert(session).values({
			id: crypto.randomUUID(),
			token: crypto.randomUUID(),
			userId: target.id,
			expiresAt: new Date(Date.now() + 1e6),
			updatedAt: new Date()
		});
		await db.insert(oauthClient).values({ id: 'c', clientId: 'client-1', redirectUris: [] });
		await db.insert(oauthAccessToken).values({
			id: crypto.randomUUID(),
			token: crypto.randomUUID(),
			clientId: 'client-1',
			userId: target.id,
			expiresAt: new Date(Date.now() + 1e6),
			createdAt: new Date(),
			scopes: []
		});
		const own = await seedConnector(target.personalWorkspaceId, target.id);
		const [run] = await db
			.insert(execution)
			.values({ workspaceId: target.personalWorkspaceId, userId: target.id, codeHash: 'h' })
			.returning();
		const heard = vi.fn();
		const unsubscribe = onKillSwitch(heard);

		const id = await activateKillSwitch({
			scope: 'user',
			targetId: target.id,
			reason: 'abuse',
			origin: 'platform_admin',
			actorUserId: admin.id
		});
		unsubscribe();
		expect(heard).toHaveBeenCalledWith({ userId: target.id });
		expect(executions.abortRunning).toHaveBeenCalledWith({
			userId: target.id,
			workspaceId: undefined
		});
		expect(executions.cancel).toHaveBeenCalledWith({ userId: target.id, executionId: run.id });
		expect(await db.select().from(session).where(eq(session.userId, target.id))).toEqual([]);
		const [token] = await db
			.select()
			.from(oauthAccessToken)
			.where(eq(oauthAccessToken.userId, target.id));
		expect(token.revoked).toBeInstanceOf(Date);
		const [u] = await db.select().from(user).where(eq(user.id, target.id));
		expect(u.suspendedAt).toBeInstanceOf(Date);
		const [c] = await db.select().from(connector).where(eq(connector.id, own.id));
		expect(c.suspendedAt).toBeInstanceOf(Date);
		expect(await codeOf(assertNotSuspended({ userId: target.id }))).toBe('SUSPENDED');
		expect(await codeOf(assertNotSuspended({ userId: admin.id }))).toBe('resolved');

		// Workspace admins cannot lift an operator's switch
		expect(
			await codeOf(releaseKillSwitch({ id, actorUserId: admin.id, asPlatformAdmin: false }))
		).toBe('FORBIDDEN');
		await releaseKillSwitch({ id, actorUserId: admin.id, asPlatformAdmin: true });
		expect(await codeOf(assertNotSuspended({ userId: target.id }))).toBe('resolved');
		const [after] = await db.select().from(connector).where(eq(connector.id, own.id));
		expect(after.suspendedAt).toBeNull();
	});

	it('workspace switch keeps manually suspended connectors suspended on release', async () => {
		const owner = await seedUser(db, { secondFactor: true });
		const { id: workspaceId } = await createWorkspace(owner.id, { name: 'Corp' });
		const shared = await seedConnector(workspaceId, null);
		const manual = await seedConnector(workspaceId, null);
		const earlier = new Date(Date.now() - 1000);
		await db.update(connector).set({ suspendedAt: earlier }).where(eq(connector.id, manual.id));

		const id = await activateKillSwitch({
			scope: 'workspace',
			targetId: workspaceId,
			reason: 'incident',
			origin: 'workspace_admin',
			actorUserId: owner.id
		});
		expect(await codeOf(assertNotSuspended({ workspaceId }))).toBe('SUSPENDED');
		expect(await codeOf(assertNotSuspended({ connectorId: shared.id }))).toBe('SUSPENDED');
		expect((await listKillSwitches({ workspaceId, activeOnly: true }))[0]).toMatchObject({
			targetLabel: 'Corp',
			origin: 'workspace_admin'
		});
		await releaseKillSwitch({ id, actorUserId: owner.id, asPlatformAdmin: false, workspaceId });
		expect(await codeOf(assertNotSuspended({ workspaceId }))).toBe('resolved');
		const rows = await db.select().from(connector).where(eq(connector.workspaceId, workspaceId));
		expect(rows.find((r) => r.id === shared.id)?.suspendedAt).toBeNull();
		expect(rows.find((r) => r.id === manual.id)?.suspendedAt).toEqual(earlier);
		const [org] = await db.select().from(organization).where(eq(organization.id, workspaceId));
		expect(org.suspendedAt).toBeNull();
	});

	it('platform switch blocks everyone and spares platform admin sessions', async () => {
		const someone = await seedUser(db);
		const admin = await seedUser(db, { email: 'admin@example.com' });
		for (const userId of [someone.id, admin.id]) {
			await db.insert(session).values({
				id: crypto.randomUUID(),
				token: crypto.randomUUID(),
				userId,
				expiresAt: new Date(Date.now() + 1e6),
				updatedAt: new Date()
			});
		}
		const id = await activateKillSwitch({
			scope: 'platform',
			reason: 'maintenance',
			origin: 'platform_admin',
			actorUserId: admin.id
		});
		expect(await codeOf(assertNotSuspended({}))).toBe('SUSPENDED');
		const left = (await db.select().from(session)).map((s) => s.userId);
		expect(left).toContain(admin.id);
		expect(left).not.toContain(someone.id);
		await releaseKillSwitch({ id, actorUserId: admin.id, asPlatformAdmin: true });
		expect(await codeOf(assertNotSuspended({}))).toBe('resolved');
	});

	it('refuses executions in workspaces scheduled for deletion', async () => {
		const owner = await seedUser(db);
		await db
			.update(organization)
			.set({ deleteScheduledAt: new Date() })
			.where(eq(organization.id, owner.personalWorkspaceId));
		expect(await codeOf(assertNotSuspended({ workspaceId: owner.personalWorkspaceId }))).toBe(
			'SUSPENDED'
		);
	});
});

describe('runner concurrency', () => {
	it('limits per user and globally, queues FIFO without head-of-line blocking', async () => {
		const pool = new SlotPool(() => ({ perUser: 1, global: 2, maxQueuedPerUser: 1 }));
		const a1 = await pool.acquire('a');
		const order: string[] = [];
		const a2 = pool.acquire('a').then((r) => (order.push('a2'), r));
		await expect(pool.acquire('a')).rejects.toMatchObject({ body: { code: 'RATE_LIMITED' } });
		const b1 = await pool.acquire('b');
		const c1 = pool.acquire('c').then((r) => (order.push('c1'), r));
		expect(pool.snapshot()).toEqual({ running: 2, queued: 2, users: 2 });
		b1();
		(await c1)();
		expect(order).toEqual(['c1']);
		a1();
		a1(); // releasing twice is a no-op
		(await a2)();
		expect(order).toEqual(['c1', 'a2']);
		expect(pool.snapshot()).toEqual({ running: 0, queued: 0, users: 0 });
	});

	it('leaves the queue when aborted', async () => {
		const pool = new SlotPool(() => ({ perUser: 1, global: 1, maxQueuedPerUser: 5 }));
		const release = await pool.acquire('a');
		const controller = new AbortController();
		const waiting = pool.acquire('b', controller.signal);
		controller.abort(new Error('client went away'));
		await expect(waiting).rejects.toThrow('client went away');
		expect(pool.snapshot().queued).toBe(0);
		release();
	});
});

describe('rate limits and settings', () => {
	it('applies per-user, per-workspace and per-IP limits', async () => {
		resetRateLimits();
		const admin = (await seedUser(db)).id;
		await updateLimits(admin, { rateLimitExecPerMin: 2, rateLimitIpPerMin: 3 });
		const ok = await checkExecutionRateLimits({ userId: 'u1', workspaceId: 'w', ip: '1.1.1.1' });
		expect(ok.allowed).toBe(true);
		await checkExecutionRateLimits({ userId: 'u1', workspaceId: 'w', ip: '1.1.1.1' });
		expect((await checkExecutionRateLimits({ userId: 'u1', workspaceId: 'w' })).allowed).toBe(
			false
		);
		expect(
			(await checkExecutionRateLimits({ userId: 'u2', workspaceId: 'w', ip: '1.1.1.1' })).allowed
		).toBe(true);
		expect(
			(await checkExecutionRateLimits({ userId: 'u3', workspaceId: 'w', ip: '1.1.1.1' })).allowed
		).toBe(false);
		await updateLimits(admin, {});
		expect((await getLimits()).rateLimitExecPerMin).toBe(defaultLimits().rateLimitExecPerMin);
	});

	it('ignores invalid overrides and rejects out-of-range updates', async () => {
		const merged = mergeLimits(defaultLimits(), {
			execTimeoutMs: -5,
			maxConcurrentPerUser: 8,
			bogus: 1
		});
		expect(merged.execTimeoutMs).toBe(defaultLimits().execTimeoutMs);
		expect(merged.maxConcurrentPerUser).toBe(8);
		expect(await codeOf(updateLimits((await seedUser(db)).id, { auditRetentionDays: 0 }))).toBe(
			'INVALID_INPUT'
		);
	});

	it('records usage per workspace and UTC day', async () => {
		const day = new Date(Date.UTC(2026, 10, 14, 23, 59));
		await recordUsage('w-usage', { executions: 1, toolCalls: 3, executionMs: 840 }, day);
		await recordUsage('w-usage', { executions: 1, failedExecutions: 1 }, day);
		const rows = await getUsage({ workspaceId: 'w-usage', from: '2026-11-14', to: '2026-11-14' });
		expect(rows).toHaveLength(1);
		expect(sumUsage(rows)).toMatchObject({
			executions: 2,
			failedExecutions: 1,
			toolCalls: 3,
			executionMs: 840
		});
	});
});
