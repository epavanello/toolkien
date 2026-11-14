import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.ts', async () => {
	const { createTestDb } = await import('#lib/server/workspaces/test-db.ts');
	return { db: await createTestDb() };
});
vi.mock('$app/env/private', () => ({ ORIGIN: 'https://toolkien.test' }));

import { db } from '#lib/server/db/index.ts';
import {
	auditEvent,
	connector,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken
} from '#lib/server/db/schema/index.ts';
import { seedUser } from '#lib/server/workspaces/test-db.ts';
import { and, eq } from 'drizzle-orm';
import {
	hasLiveGrant,
	listAuthorizedClients,
	needsGuide,
	onboardingStatus,
	revokeClient
} from './index.ts';

const NOW = new Date('2026-11-14T12:00:00Z');
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

async function addClient(name: string | null) {
	const clientId = `client-${crypto.randomUUID()}`;
	await db.insert(oauthClient).values({
		id: crypto.randomUUID(),
		clientId,
		name,
		redirectUris: ['http://127.0.0.1:3000/callback']
	});
	return clientId;
}

async function consent(userId: string, clientId: string, at: Date) {
	await db.insert(oauthConsent).values({
		id: crypto.randomUUID(),
		clientId,
		userId,
		scopes: ['openid'],
		createdAt: at,
		updatedAt: at
	});
}

async function refreshToken(
	userId: string,
	clientId: string,
	options: { createdAt: Date; expiresAt: Date; revoked?: Date }
) {
	await db.insert(oauthRefreshToken).values({
		id: crypto.randomUUID(),
		token: crypto.randomUUID(),
		clientId,
		userId,
		scopes: ['openid'],
		createdAt: options.createdAt,
		expiresAt: options.expiresAt,
		revoked: options.revoked ?? null
	});
}

const actorOf = (user: { id: string; personalWorkspaceId: string }) => ({
	workspaceId: user.personalWorkspaceId,
	userId: user.id,
	role: 'owner' as const
});

describe('authorized clients', () => {
	it('lists consented clients and live tokens, newest activity first, never token values', async () => {
		const me = await seedUser(db);
		const cursor = await addClient('Cursor');
		const claude = await addClient('Claude Code (toolkien)');
		await consent(me.id, cursor, minutes(-120));
		await refreshToken(me.id, claude, { createdAt: minutes(-30), expiresAt: minutes(60) });
		await db.insert(oauthAccessToken).values({
			id: crypto.randomUUID(),
			token: crypto.randomUUID(),
			clientId: cursor,
			userId: me.id,
			scopes: ['openid'],
			createdAt: minutes(-90),
			expiresAt: minutes(-75)
		});

		const clients = await listAuthorizedClients(me.id, NOW);
		expect(clients.map((c) => c.name)).toEqual(['Claude Code (toolkien)', 'Cursor']);
		expect(clients[1]).toMatchObject({ connectedAt: minutes(-120), lastUsedAt: minutes(-90) });
		expect(JSON.stringify(clients)).not.toMatch(/token/i);
	});

	it('skips clients whose tokens are all revoked or expired and that have no consent', async () => {
		const me = await seedUser(db);
		const revoked = await addClient('Revoked');
		const expired = await addClient('Expired');
		await refreshToken(me.id, revoked, {
			createdAt: minutes(-10),
			expiresAt: minutes(60),
			revoked: minutes(-5)
		});
		await refreshToken(me.id, expired, { createdAt: minutes(-100), expiresAt: minutes(-1) });
		expect(await listAuthorizedClients(me.id, NOW)).toEqual([]);
	});

	it('counts audited calls as last use and names unnamed clients', async () => {
		const me = await seedUser(db);
		const client = await addClient(null);
		await consent(me.id, client, minutes(-60));
		await db.insert(auditEvent).values({
			type: 'tool.called',
			outcome: 'success',
			userId: me.id,
			workspaceId: me.personalWorkspaceId,
			clientId: client,
			occurredAt: minutes(-2)
		});
		const [row] = await listAuthorizedClients(me.id, NOW);
		expect(row).toMatchObject({ name: 'Unnamed MCP client', lastUsedAt: minutes(-2) });
	});

	it("never shows another user's clients", async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		await consent(other.id, await addClient('Theirs'), minutes(-1));
		expect(await listAuthorizedClients(me.id, NOW)).toEqual([]);
	});
});

describe('disconnecting a client', () => {
	const tokensOf = async (userId: string, clientId: string) => ({
		access: await db
			.select()
			.from(oauthAccessToken)
			.where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId))),
		refresh: await db
			.select()
			.from(oauthRefreshToken)
			.where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId))),
		consent: await db
			.select()
			.from(oauthConsent)
			.where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
	});

	it("deletes the user's consent and tokens for that client only, and audits it", async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const cursor = await addClient('Cursor');
		const codex = await addClient('Codex');
		for (const user of [me, other]) {
			await consent(user.id, cursor, minutes(-60));
			await refreshToken(user.id, cursor, { createdAt: minutes(-5), expiresAt: minutes(60) });
		}
		await consent(me.id, codex, minutes(-30));
		await db.insert(oauthAccessToken).values({
			id: crypto.randomUUID(),
			token: crypto.randomUUID(),
			clientId: cursor,
			userId: me.id,
			scopes: ['openid'],
			createdAt: minutes(-1),
			expiresAt: minutes(14)
		});
		expect(await hasLiveGrant(me.id, cursor, NOW)).toBe(true);

		const revoked = await revokeClient(actorOf(me), cursor);
		expect(revoked).toEqual({
			clientId: cursor,
			name: 'Cursor',
			accessTokens: 1,
			refreshTokens: 1,
			consents: 1
		});
		expect(await tokensOf(me.id, cursor)).toEqual({ access: [], refresh: [], consent: [] });
		expect(await hasLiveGrant(me.id, cursor, NOW)).toBe(false);
		expect((await listAuthorizedClients(me.id, NOW)).map((c) => c.name)).toEqual(['Codex']);
		// Another user of the same client keeps their access
		expect(await hasLiveGrant(other.id, cursor, NOW)).toBe(true);
		expect((await tokensOf(other.id, cursor)).refresh).toHaveLength(1);

		const [event] = await db
			.select()
			.from(auditEvent)
			.where(and(eq(auditEvent.userId, me.id), eq(auditEvent.type, 'mcp_client.revoked')));
		expect(event).toMatchObject({
			outcome: 'success',
			workspaceId: me.personalWorkspaceId,
			clientId: cursor,
			clientName: 'Cursor',
			metadata: { accessTokens: 1, refreshTokens: 1, consents: 1 }
		});
		expect(JSON.stringify(event)).not.toMatch(/token":"/);
	});

	it('answers 404 for a client the user never authorized or already disconnected', async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const theirs = await addClient('Theirs');
		await consent(other.id, theirs, minutes(-1));
		await expect(revokeClient(actorOf(me), theirs)).rejects.toMatchObject({ status: 404 });
		await revokeClient(actorOf(other), theirs);
		await expect(revokeClient(actorOf(other), theirs)).rejects.toMatchObject({ status: 404 });
	});

	it('a revoked or expired refresh token is not a live grant', async () => {
		const me = await seedUser(db);
		const client = await addClient('Old');
		await refreshToken(me.id, client, {
			createdAt: minutes(-10),
			expiresAt: minutes(60),
			revoked: minutes(-5)
		});
		await refreshToken(me.id, client, { createdAt: minutes(-100), expiresAt: minutes(-1) });
		expect(await hasLiveGrant(me.id, client, NOW)).toBe(false);
	});
});

describe('onboarding status', () => {
	it('starts empty and asks for the connect guide', async () => {
		const me = await seedUser(db);
		const status = await onboardingStatus(actorOf(me), NOW);
		expect(status).toEqual({
			mcpUrl: 'https://toolkien.test/mcp',
			connectors: [],
			clients: [],
			triedPrompt: false
		});
		expect(await needsGuide(actorOf(me), NOW)).toBe(true);
	});

	it('ticks from connectors, clients and calls in this workspace only', async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const base = {
			workspaceId: me.personalWorkspaceId,
			scope: 'personal' as const,
			source: 'directory' as const,
			url: 'https://mcp.example.com',
			authType: 'oauth' as const
		};
		await db.insert(connector).values([
			{ ...base, name: 'PostHog', namespace: 'posthog', ownerUserId: me.id },
			{ ...base, name: 'Hidden', namespace: 'hidden', ownerUserId: other.id }
		]);
		expect(await needsGuide(actorOf(me), NOW)).toBe(false);

		await consent(me.id, await addClient('Codex'), minutes(-5));
		await db.insert(auditEvent).values({
			type: 'execution.started',
			outcome: 'pending',
			userId: me.id,
			workspaceId: other.personalWorkspaceId
		});
		let status = await onboardingStatus(actorOf(me), NOW);
		expect(status.connectors).toEqual(['PostHog']);
		expect(status.clients.map((c) => c.name)).toEqual(['Codex']);
		expect(status.triedPrompt).toBe(false);

		await db.insert(auditEvent).values({
			type: 'execution.started',
			outcome: 'pending',
			userId: me.id,
			workspaceId: me.personalWorkspaceId
		});
		status = await onboardingStatus(actorOf(me), NOW);
		expect(status.triedPrompt).toBe(true);
	});
});
