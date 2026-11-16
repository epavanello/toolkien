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
	organization,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken
} from '#lib/server/db/schema/index.ts';
import { seedMember, seedUser } from '#lib/server/workspaces/test-db.ts';
import { and, eq } from 'drizzle-orm';
import {
	cleanClientLabel,
	clientLabel,
	hasLiveGrant,
	listAuthorizedClients,
	moveClient,
	needsGuide,
	onboardingStatus,
	rememberClientInfo,
	revokeClient,
	setClientLabel,
	storeClientLabel,
	storedClientInfo
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

describe('MCP client info', () => {
	it('is kept per user and client, updated, and goes with a disconnect', async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const cursor = await addClient('Cursor');
		await consent(me.id, cursor, minutes(-60));
		expect(await storedClientInfo(me.id, cursor)).toBeNull();
		await rememberClientInfo(me.id, cursor, 'cursor-vscode 1.0.0');
		await rememberClientInfo(me.id, cursor, 'cursor-vscode 1.1.0');
		await rememberClientInfo(other.id, cursor, 'cursor-vscode 0.9.0');
		expect(await storedClientInfo(me.id, cursor)).toBe('cursor-vscode 1.1.0');
		await revokeClient({ workspaceId: crypto.randomUUID(), userId: me.id, role: 'owner' }, cursor);
		expect(await storedClientInfo(me.id, cursor)).toBeNull();
		expect(await storedClientInfo(other.id, cursor)).toBe('cursor-vscode 0.9.0');
	});
});

describe('client names', () => {
	it('cleans names: one line, no control characters, capped', () => {
		expect(cleanClientLabel('  Work\n\tlaptop \u0007 ')).toBe('Work laptop');
		expect(cleanClientLabel('   ')).toBeNull();
		expect(cleanClientLabel(null)).toBeNull();
		expect(cleanClientLabel('x'.repeat(80))).toHaveLength(60);
	});

	it('replaces the registered name for that user only; empty or equal clears it', async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const claude = await addClient('Claude Code');
		await consent(me.id, claude, minutes(-60));
		await consent(other.id, claude, minutes(-60));

		expect(await storeClientLabel(me.id, claude, '  Work laptop ')).toBe('Work laptop');
		expect(await clientLabel(me.id, claude)).toBe('Work laptop');
		expect(await clientLabel(other.id, claude)).toBeNull();
		const [mine] = await listAuthorizedClients(me.id, NOW);
		expect(mine).toMatchObject({ name: 'Work laptop', registeredName: 'Claude Code' });
		const [theirs] = await listAuthorizedClients(other.id, NOW);
		expect(theirs).toMatchObject({ name: 'Claude Code', registeredName: 'Claude Code' });

		expect(await storeClientLabel(me.id, claude, 'Claude Code')).toBe('Claude Code');
		expect(await clientLabel(me.id, claude)).toBeNull();
		await storeClientLabel(me.id, claude, 'Home');
		expect(await storeClientLabel(me.id, claude, '')).toBe('Claude Code');
		expect(await clientLabel(me.id, claude)).toBeNull();
	});

	it('renames an authorized client with an audit event, 404 otherwise', async () => {
		const me = await seedUser(db);
		const claude = await addClient('Claude Code');
		const notMine = await addClient('Other');
		await consent(me.id, claude, minutes(-60));

		expect(await setClientLabel(actorOf(me), claude, 'Work laptop')).toEqual({
			clientId: claude,
			name: 'Work laptop'
		});
		// Same name again: nothing to audit
		await setClientLabel(actorOf(me), claude, 'Work laptop');
		const events = await db
			.select()
			.from(auditEvent)
			.where(and(eq(auditEvent.userId, me.id), eq(auditEvent.type, 'mcp_client.renamed')));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			workspaceId: me.personalWorkspaceId,
			clientId: claude,
			clientName: 'Work laptop',
			metadata: { previousName: 'Claude Code' }
		});
		await expect(setClientLabel(actorOf(me), notMine, 'x')).rejects.toMatchObject({
			status: 404
		});
	});

	it('is used on disconnect and goes with it', async () => {
		const me = await seedUser(db);
		const claude = await addClient('Claude Code');
		await consent(me.id, claude, minutes(-60));
		await storeClientLabel(me.id, claude, 'Work laptop');
		const revoked = await revokeClient(actorOf(me), claude);
		expect(revoked.name).toBe('Work laptop');
		expect(await clientLabel(me.id, claude)).toBeNull();
	});
});

describe('client workspaces', () => {
	async function companyOf(userId: string, name = 'Acme') {
		const id = crypto.randomUUID();
		await db.insert(organization).values({
			id,
			name,
			slug: `acme-${id.replace(/-/g, '')}`,
			kind: 'company',
			createdAt: new Date()
		});
		await seedMember(db, id, userId, 'owner');
		return id;
	}

	it('each client works in its own workspace and moves alone, audited', async () => {
		const me = await seedUser(db);
		const acme = await companyOf(me.id);
		const codex = await addClient('Codex');
		const claude = await addClient('Claude Code');
		await consent(me.id, codex, minutes(-60));
		await consent(me.id, claude, minutes(-30));

		const before = await listAuthorizedClients(me.id, NOW);
		expect(before.map((c) => c.workspace?.id)).toEqual([
			me.personalWorkspaceId,
			me.personalWorkspaceId
		]);

		const moved = await moveClient(actorOf(me), claude, acme);
		expect(moved.workspace).toMatchObject({ id: acme, name: 'Acme', kind: 'company' });
		const after = new Map(
			(await listAuthorizedClients(me.id, NOW)).map((c) => [c.clientId, c.workspace?.id])
		);
		expect(after.get(claude)).toBe(acme);
		expect(after.get(codex)).toBe(me.personalWorkspaceId);

		// Already there: nothing more to record
		await moveClient(actorOf(me), claude, acme);
		const events = await db
			.select()
			.from(auditEvent)
			.where(and(eq(auditEvent.userId, me.id), eq(auditEvent.type, 'workspace.switched')));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			workspaceId: acme,
			clientId: claude,
			clientName: 'Claude Code',
			approvedBy: 'self',
			metadata: { fromWorkspaceId: me.personalWorkspaceId, channel: 'settings' }
		});

		// Moving or renaming it from the app is not the client being used
		await setClientLabel(actorOf(me), claude, 'Work');
		const [listed] = (await listAuthorizedClients(me.id, NOW)).filter((c) => c.clientId === claude);
		expect(listed.lastUsedAt).toBeNull();

		const status = await onboardingStatus(actorOf(me), NOW);
		expect(status.workspaces.map((w) => w.id).sort()).toEqual(
			[acme, me.personalWorkspaceId].sort()
		);
	});

	it('refuses a workspace the user is not in, or a client they did not authorize', async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const theirs = await companyOf(other.id, 'Theirs');
		const codex = await addClient('Codex');
		const notMine = await addClient('Other');
		await consent(me.id, codex, minutes(-60));
		await expect(moveClient(actorOf(me), codex, theirs)).rejects.toMatchObject({ status: 404 });
		await expect(moveClient(actorOf(me), notMine, me.personalWorkspaceId)).rejects.toMatchObject({
			status: 404
		});
	});
});

describe('onboarding status', () => {
	it('starts empty and asks for the connect guide', async () => {
		const me = await seedUser(db);
		const status = await onboardingStatus(actorOf(me), NOW);
		expect(status).toEqual({
			mcpUrl: 'https://toolkien.test/mcp',
			connectors: [],
			servers: [],
			clients: [],
			workspaces: [
				{ id: me.personalWorkspaceId, slug: expect.any(String), name: 'Personal', kind: 'personal' }
			],
			triedPrompt: false,
			firstCall: null
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
		expect(status.servers).toEqual([{ name: 'PostHog', icon: null }]);
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

	it('a tool search through a client is enough: the first call names tool, client and time', async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const event = (values: Partial<typeof auditEvent.$inferInsert>) =>
			db.insert(auditEvent).values({
				outcome: 'success',
				userId: me.id,
				workspaceId: me.personalWorkspaceId,
				type: 'tools.searched',
				...values
			});
		// Another member's call and an unrelated event do not count
		await event({ userId: other.id, clientName: 'Cursor', occurredAt: minutes(-30) });
		await event({ type: 'connector.added', occurredAt: minutes(-20) });
		expect((await onboardingStatus(actorOf(me), NOW)).firstCall).toBeNull();

		await event({ type: 'tools.described', clientName: 'Codex', occurredAt: minutes(-5) });
		await event({ clientName: ' Claude Code ', occurredAt: minutes(-10) });
		const status = await onboardingStatus(actorOf(me), NOW);
		expect(status.triedPrompt).toBe(true);
		expect(status.firstCall).toEqual({
			tool: 'tools_search',
			clientName: 'Claude Code',
			at: minutes(-10)
		});
	});

	it('names the upstream tool of a direct call and executions as execute', async () => {
		const me = await seedUser(db);
		const base = {
			outcome: 'success' as const,
			userId: me.id,
			workspaceId: me.personalWorkspaceId
		};
		await db.insert(auditEvent).values({
			...base,
			type: 'tool.called',
			toolPath: 'github.listIssues',
			occurredAt: minutes(-3)
		});
		expect((await onboardingStatus(actorOf(me), NOW)).firstCall).toMatchObject({
			tool: 'github.listIssues',
			clientName: null
		});
		await db.insert(auditEvent).values({
			...base,
			type: 'execution.started',
			clientName: 'Codex',
			occurredAt: minutes(-4)
		});
		expect((await onboardingStatus(actorOf(me), NOW)).firstCall).toMatchObject({
			tool: 'execute',
			clientName: 'Codex'
		});
	});
});
