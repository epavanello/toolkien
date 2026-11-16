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
	mcpConnection,
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
	createConnection,
	hasLiveGrant,
	listAuthorizedClients,
	loadConnection,
	moveClient,
	needsGuide,
	onboardingStatus,
	rememberClientInfo,
	revokeClient,
	setClientLabel
} from './index.ts';
import { getActiveWorkspace } from '#lib/server/workspaces/active.ts';

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

/** What one "Allow access" leaves behind: the connection and its consent (`reference_id`) */
async function connect(
	userId: string,
	clientId: string,
	at: Date,
	options: { label?: string; workspaceId?: string } = {}
) {
	const id = crypto.randomUUID();
	await db.insert(mcpConnection).values({
		id,
		userId,
		clientId,
		label: options.label ?? null,
		workspaceId: options.workspaceId ?? null,
		createdAt: at
	});
	await db.insert(oauthConsent).values({
		id: crypto.randomUUID(),
		clientId,
		userId,
		referenceId: id,
		scopes: ['openid'],
		createdAt: at,
		updatedAt: at
	});
	return id;
}

async function refreshToken(
	userId: string,
	clientId: string,
	connectionId: string,
	options: { createdAt: Date; expiresAt: Date; revoked?: Date }
) {
	await db.insert(oauthRefreshToken).values({
		id: crypto.randomUUID(),
		token: crypto.randomUUID(),
		clientId,
		userId,
		referenceId: connectionId,
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

describe('authorized connections', () => {
	it('lists approved connections, newest activity first, never token values', async () => {
		const me = await seedUser(db);
		const cursor = await addClient('Cursor');
		const claude = await addClient('Claude Code (toolkien)');
		const viaCursor = await connect(me.id, cursor, minutes(-120));
		await refreshToken(me.id, cursor, viaCursor, {
			createdAt: minutes(-90),
			expiresAt: minutes(60)
		});
		const viaClaude = await connect(me.id, claude, minutes(-40));
		await refreshToken(me.id, claude, viaClaude, {
			createdAt: minutes(-30),
			expiresAt: minutes(60)
		});

		const clients = await listAuthorizedClients(me.id, NOW);
		expect(clients.map((c) => c.name)).toEqual(['Claude Code (toolkien)', 'Cursor']);
		expect(clients[1]).toMatchObject({
			connectionId: viaCursor,
			clientId: cursor,
			connectedAt: minutes(-120),
			lastUsedAt: minutes(-90)
		});
		expect(JSON.stringify(clients)).not.toMatch(/token/i);
	});

	it('two sign-ins of the same client are two connections, each with its own name and workspace', async () => {
		const me = await seedUser(db);
		const claude = await addClient('Claude');
		const acme = crypto.randomUUID();
		await db.insert(organization).values({
			id: acme,
			name: 'Acme',
			slug: `acme-${acme.replace(/-/g, '')}`,
			kind: 'company',
			createdAt: new Date()
		});
		await seedMember(db, acme, me.id, 'owner');
		const emanuele = await createConnection({
			userId: me.id,
			clientId: claude,
			label: 'Claude — Emanuele',
			workspaceId: me.personalWorkspaceId
		});
		const agent = await createConnection({
			userId: me.id,
			clientId: claude,
			label: 'Claude — Agent',
			workspaceId: acme
		});
		for (const { connectionId } of [emanuele, agent]) {
			await db.insert(oauthConsent).values({
				id: crypto.randomUUID(),
				clientId: claude,
				userId: me.id,
				referenceId: connectionId,
				scopes: ['openid'],
				createdAt: minutes(-5),
				updatedAt: minutes(-5)
			});
		}

		const listed = new Map(
			(await listAuthorizedClients(me.id, NOW)).map((c) => [c.connectionId, c])
		);
		expect(listed.get(emanuele.connectionId)).toMatchObject({
			name: 'Claude — Emanuele',
			workspace: { id: me.personalWorkspaceId }
		});
		expect(listed.get(agent.connectionId)).toMatchObject({
			name: 'Claude — Agent',
			workspace: { id: acme }
		});
		expect((await getActiveWorkspace(me.id, agent.connectionId)).id).toBe(acme);
		expect((await getActiveWorkspace(me.id, emanuele.connectionId)).id).toBe(
			me.personalWorkspaceId
		);

		// Renaming, moving and disconnecting one leaves the other alone
		await setClientLabel(actorOf(me), agent.connectionId, 'Agent');
		await moveClient(actorOf(me), agent.connectionId, me.personalWorkspaceId);
		expect((await loadConnection(emanuele.connectionId))?.label).toBe('Claude — Emanuele');
		await revokeClient(actorOf(me), agent.connectionId);
		expect(await hasLiveGrant(me.id, agent.connectionId, NOW)).toBe(false);
		expect(await hasLiveGrant(me.id, emanuele.connectionId, NOW)).toBe(true);
		expect((await listAuthorizedClients(me.id, NOW)).map((c) => c.name)).toEqual([
			'Claude — Emanuele'
		]);
	});

	it('drops connections whose grant is over: no consent, or every refresh token dead', async () => {
		const me = await seedUser(db);
		const revoked = await addClient('Revoked');
		const expired = await addClient('Expired');
		const viaRevoked = await connect(me.id, revoked, minutes(-20));
		await refreshToken(me.id, revoked, viaRevoked, {
			createdAt: minutes(-10),
			expiresAt: minutes(60),
			revoked: minutes(-5)
		});
		const viaExpired = await connect(me.id, expired, minutes(-200));
		await refreshToken(me.id, expired, viaExpired, {
			createdAt: minutes(-100),
			expiresAt: minutes(-1)
		});
		// A connection the provider never consented to (the "Allow" failed)
		await createConnection({
			userId: me.id,
			clientId: expired,
			label: null,
			workspaceId: me.personalWorkspaceId
		});
		expect(await listAuthorizedClients(me.id, NOW)).toEqual([]);
		expect(await hasLiveGrant(me.id, viaRevoked, NOW)).toBe(false);
		expect(await hasLiveGrant(me.id, viaExpired, NOW)).toBe(false);
	});

	it('counts audited calls as last use and names unnamed clients', async () => {
		const me = await seedUser(db);
		const client = await addClient(null);
		const connectionId = await connect(me.id, client, minutes(-60));
		await db.insert(auditEvent).values({
			type: 'tool.called',
			outcome: 'success',
			userId: me.id,
			workspaceId: me.personalWorkspaceId,
			clientId: client,
			connectionId,
			occurredAt: minutes(-2)
		});
		const [row] = await listAuthorizedClients(me.id, NOW);
		expect(row).toMatchObject({ name: 'Unnamed MCP client', lastUsedAt: minutes(-2) });
	});

	it("never shows another user's connections", async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		await connect(other.id, await addClient('Theirs'), minutes(-1));
		expect(await listAuthorizedClients(me.id, NOW)).toEqual([]);
	});
});

describe('disconnecting a connection', () => {
	const grantOf = async (userId: string, connectionId: string) => ({
		access: await db
			.select()
			.from(oauthAccessToken)
			.where(
				and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.referenceId, connectionId))
			),
		refresh: await db
			.select()
			.from(oauthRefreshToken)
			.where(
				and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.referenceId, connectionId))
			),
		consent: await db
			.select()
			.from(oauthConsent)
			.where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.referenceId, connectionId)))
	});

	it('deletes that connection, its consent and tokens only, and audits it', async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const cursor = await addClient('Cursor');
		const codex = await addClient('Codex');
		const connections = new Map<string, string>();
		for (const user of [me, other]) {
			const id = await connect(user.id, cursor, minutes(-60));
			await refreshToken(user.id, cursor, id, { createdAt: minutes(-5), expiresAt: minutes(60) });
			connections.set(user.id, id);
		}
		const mine = connections.get(me.id)!;
		const theirs = connections.get(other.id)!;
		await connect(me.id, codex, minutes(-30));
		await db.insert(oauthAccessToken).values({
			id: crypto.randomUUID(),
			token: crypto.randomUUID(),
			clientId: cursor,
			userId: me.id,
			referenceId: mine,
			scopes: ['openid'],
			createdAt: minutes(-1),
			expiresAt: minutes(14)
		});
		expect(await hasLiveGrant(me.id, mine, NOW)).toBe(true);

		const revoked = await revokeClient(actorOf(me), mine);
		expect(revoked).toEqual({
			connectionId: mine,
			clientId: cursor,
			name: 'Cursor',
			accessTokens: 1,
			refreshTokens: 1,
			consents: 1
		});
		expect(await grantOf(me.id, mine)).toEqual({ access: [], refresh: [], consent: [] });
		expect(await loadConnection(mine)).toBeNull();
		expect(await hasLiveGrant(me.id, mine, NOW)).toBe(false);
		expect((await listAuthorizedClients(me.id, NOW)).map((c) => c.name)).toEqual(['Codex']);
		// Another user of the same client keeps their access
		expect(await hasLiveGrant(other.id, theirs, NOW)).toBe(true);
		expect((await grantOf(other.id, theirs)).refresh).toHaveLength(1);

		const [event] = await db
			.select()
			.from(auditEvent)
			.where(and(eq(auditEvent.userId, me.id), eq(auditEvent.type, 'mcp_client.revoked')));
		expect(event).toMatchObject({
			outcome: 'success',
			workspaceId: me.personalWorkspaceId,
			clientId: cursor,
			connectionId: mine,
			clientName: 'Cursor',
			metadata: { accessTokens: 1, refreshTokens: 1, consents: 1 }
		});
		expect(JSON.stringify(event)).not.toMatch(/token":"/);
	});

	it("answers 404 for another user's connection or one already disconnected", async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const theirs = await connect(other.id, await addClient('Theirs'), minutes(-1));
		await expect(revokeClient(actorOf(me), theirs)).rejects.toMatchObject({ status: 404 });
		await revokeClient(actorOf(other), theirs);
		await expect(revokeClient(actorOf(other), theirs)).rejects.toMatchObject({ status: 404 });
	});
});

describe('MCP client info', () => {
	it('is kept per connection and updated', async () => {
		const me = await seedUser(db);
		const cursor = await addClient('Cursor');
		const first = await connect(me.id, cursor, minutes(-60));
		const second = await connect(me.id, cursor, minutes(-30));
		expect((await loadConnection(first))?.clientInfo).toBeNull();
		await rememberClientInfo(first, 'cursor-vscode 1.0.0');
		await rememberClientInfo(first, 'cursor-vscode 1.1.0');
		await rememberClientInfo(second, 'cursor-vscode 0.9.0');
		expect((await loadConnection(first))?.clientInfo).toBe('cursor-vscode 1.1.0');
		expect((await loadConnection(second))?.clientInfo).toBe('cursor-vscode 0.9.0');
	});
});

describe('connection names', () => {
	it('cleans names: one line, no control characters, capped', () => {
		expect(cleanClientLabel('  Work\n\tlaptop \u0007 ')).toBe('Work laptop');
		expect(cleanClientLabel('   ')).toBeNull();
		expect(cleanClientLabel(null)).toBeNull();
		expect(cleanClientLabel('x'.repeat(80))).toHaveLength(60);
	});

	it('starts from the consent screen; empty or equal to the registered name stores none', async () => {
		const me = await seedUser(db);
		const claude = await addClient('Claude Code');
		const named = await createConnection({
			userId: me.id,
			clientId: claude,
			label: '  Work laptop ',
			workspaceId: me.personalWorkspaceId
		});
		expect(named.name).toBe('Work laptop');
		expect((await loadConnection(named.connectionId))?.label).toBe('Work laptop');
		for (const label of ['Claude Code', '', null]) {
			const plain = await createConnection({
				userId: me.id,
				clientId: claude,
				label,
				workspaceId: me.personalWorkspaceId
			});
			expect(plain.name).toBe('Claude Code');
			expect((await loadConnection(plain.connectionId))?.label).toBeNull();
		}
	});

	it('renames an authorized connection with an audit event, 404 otherwise', async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const claude = await addClient('Claude Code');
		const mine = await connect(me.id, claude, minutes(-60));
		const theirs = await connect(other.id, claude, minutes(-60));

		expect(await setClientLabel(actorOf(me), mine, 'Work laptop')).toEqual({
			connectionId: mine,
			name: 'Work laptop'
		});
		expect((await loadConnection(mine))?.label).toBe('Work laptop');
		// Same name again: nothing to audit
		await setClientLabel(actorOf(me), mine, 'Work laptop');
		const events = await db
			.select()
			.from(auditEvent)
			.where(and(eq(auditEvent.userId, me.id), eq(auditEvent.type, 'mcp_client.renamed')));
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			workspaceId: me.personalWorkspaceId,
			clientId: claude,
			connectionId: mine,
			clientName: 'Work laptop',
			metadata: { previousName: 'Claude Code' }
		});
		// Empty restores the registered name
		expect((await setClientLabel(actorOf(me), mine, '')).name).toBe('Claude Code');
		expect((await loadConnection(mine))?.label).toBeNull();
		await expect(setClientLabel(actorOf(me), theirs, 'x')).rejects.toMatchObject({
			status: 404
		});
	});

	it('is used on disconnect', async () => {
		const me = await seedUser(db);
		const claude = await addClient('Claude Code');
		const id = await connect(me.id, claude, minutes(-60), { label: 'Work laptop' });
		const revoked = await revokeClient(actorOf(me), id);
		expect(revoked.name).toBe('Work laptop');
	});
});

describe('connection workspaces', () => {
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

	it('each connection works in its own workspace and moves alone, audited', async () => {
		const me = await seedUser(db);
		const acme = await companyOf(me.id);
		const codex = await connect(me.id, await addClient('Codex'), minutes(-60));
		const claude = await connect(me.id, await addClient('Claude Code'), minutes(-30));

		const before = await listAuthorizedClients(me.id, NOW);
		expect(before.map((c) => c.workspace?.id)).toEqual([
			me.personalWorkspaceId,
			me.personalWorkspaceId
		]);

		const moved = await moveClient(actorOf(me), claude, acme);
		expect(moved.workspace).toMatchObject({ id: acme, name: 'Acme', kind: 'company' });
		const after = new Map(
			(await listAuthorizedClients(me.id, NOW)).map((c) => [c.connectionId, c.workspace?.id])
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
			connectionId: claude,
			clientName: 'Claude Code',
			approvedBy: 'self',
			metadata: { fromWorkspaceId: me.personalWorkspaceId, channel: 'settings' }
		});

		// Moving or renaming it from the app is not the client being used
		await setClientLabel(actorOf(me), claude, 'Work');
		const [listed] = (await listAuthorizedClients(me.id, NOW)).filter(
			(c) => c.connectionId === claude
		);
		expect(listed.lastUsedAt).toBeNull();

		const status = await onboardingStatus(actorOf(me), NOW);
		expect(status.workspaces.map((w) => w.id).sort()).toEqual(
			[acme, me.personalWorkspaceId].sort()
		);
	});

	it('refuses a workspace the user is not in, or a connection that is not theirs', async () => {
		const me = await seedUser(db);
		const other = await seedUser(db);
		const theirs = await companyOf(other.id, 'Theirs');
		const codex = await connect(me.id, await addClient('Codex'), minutes(-60));
		const notMine = await connect(other.id, await addClient('Other'), minutes(-60));
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

		await connect(me.id, await addClient('Codex'), minutes(-5));
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
