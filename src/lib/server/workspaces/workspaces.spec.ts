import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.ts', async () => {
	const { createTestDb } = await import('./test-db.ts');
	return { db: await createTestDb() };
});
// The modules this one reaches lazily (`await import(...)`) when a member leaves or a workspace
// is scheduled for deletion: their own specs cover them. Loaded for real, their module graphs
// (MCP SDK, typegen, crypto, runner) were transformed inside the first test that reached them,
// about 1 s alone and past the 5 s test timeout under the load of the full parallel run.
const { connectors, limits } = vi.hoisted(() => ({
	connectors: { remove: vi.fn(async () => {}), revokeUserCredentials: vi.fn(async () => 0) },
	limits: { cancelExecutionsInScope: vi.fn(async () => {}) }
}));
vi.mock('#lib/server/connectors/index.ts', () => connectors);
vi.mock('#lib/server/limits/index.ts', () => limits);

import { db } from '#lib/server/db/index.ts';
import {
	auditEvent,
	mcpConnection,
	organization,
	workspaceInviteLink
} from '#lib/server/db/schema/index.ts';
import { eq } from 'drizzle-orm';
import {
	acceptInvite,
	cancelDeletion,
	changeRole,
	checkConnectorPolicy,
	createInviteLink,
	createWorkspace,
	DELETION_GRACE_DAYS,
	getActiveWorkspace,
	getById,
	getInvitePreview,
	getPolicy,
	listInviteLinks,
	listMembers,
	normalizeAllowedServers,
	purgeScheduledDeletions,
	removeMember,
	revokeInviteLink,
	scheduleDeletion,
	setActiveWorkspace,
	transferOwnership,
	updatePolicy
} from './index.ts';
import { seedMember, seedUser } from './test-db.ts';
import type { WorkspaceActor } from './types.ts';

const DAY = 24 * 60 * 60 * 1000;

async function companyWithOwner() {
	const owner = await seedUser(db, { secondFactor: true });
	const { id, slug } = await createWorkspace(owner.id, { name: 'Acme Inc.' });
	const actor: WorkspaceActor = { workspaceId: id, userId: owner.id, role: 'owner' };
	return { owner, workspaceId: id, slug, actor };
}

const codeOf = (promise: Promise<unknown>) =>
	promise.then(
		() => 'resolved',
		(e: { body?: { code?: string } }) => e.body?.code ?? 'unknown'
	);

describe('company workspaces and roles', () => {
	it('requires a second factor to create a company workspace', async () => {
		const user = await seedUser(db);
		expect(await codeOf(createWorkspace(user.id, { name: 'Nope' }))).toBe('SECOND_FACTOR_REQUIRED');
		const { slug } = await companyWithOwner();
		expect(slug).toMatch(/^acme-inc-[a-z0-9]{4}$/);
	});

	it('members cannot manage members; admins need a second factor', async () => {
		const { workspaceId, actor } = await companyWithOwner();
		const member = await seedUser(db);
		const admin = await seedUser(db);
		await seedMember(db, workspaceId, member.id, 'member');
		await seedMember(db, workspaceId, admin.id, 'admin');

		const asMember: WorkspaceActor = { workspaceId, userId: member.id, role: 'member' };
		expect(await codeOf(changeRole(asMember, admin.id, 'member'))).toBe('FORBIDDEN');
		expect(await codeOf(createInviteLink(asMember, { role: 'member' }))).toBe('FORBIDDEN');

		// An admin without passkey loses admin powers
		const asAdmin: WorkspaceActor = { workspaceId, userId: admin.id, role: 'admin' };
		expect(await codeOf(createInviteLink(asAdmin, { role: 'member' }))).toBe(
			'SECOND_FACTOR_REQUIRED'
		);

		// Granting admin requires the target's second factor
		expect(await codeOf(changeRole(actor, member.id, 'admin'))).toBe('SECOND_FACTOR_REQUIRED');
		const strong = await seedUser(db, { secondFactor: true });
		await seedMember(db, workspaceId, strong.id, 'member');
		await changeRole(actor, strong.id, 'admin');
		const members = await listMembers(actor);
		expect(members.find((m) => m.userId === strong.id)?.role).toBe('admin');
		expect(members.find((m) => m.userId === strong.id)?.secondFactor).toBe(true);
		// Members see the list without passkey status
		expect((await listMembers(asMember)).every((m) => m.secondFactor === null)).toBe(true);
	});

	it('protects the owner and transfers ownership to a member with a second factor', async () => {
		const { owner, workspaceId, actor } = await companyWithOwner();
		const admin = await seedUser(db, { secondFactor: true });
		const plain = await seedUser(db);
		await seedMember(db, workspaceId, admin.id, 'admin');
		await seedMember(db, workspaceId, plain.id, 'member');
		const asAdmin: WorkspaceActor = { workspaceId, userId: admin.id, role: 'admin' };

		expect(await codeOf(changeRole(asAdmin, owner.id, 'member'))).toBe('INVALID_INPUT');
		expect(await codeOf(removeMember(asAdmin, owner.id))).toBe('INVALID_INPUT');
		expect(await codeOf(removeMember(actor, owner.id))).toBe('INVALID_INPUT');
		expect(await codeOf(transferOwnership(asAdmin, admin.id))).toBe('FORBIDDEN');
		expect(await codeOf(transferOwnership(actor, plain.id))).toBe('SECOND_FACTOR_REQUIRED');

		await transferOwnership(actor, admin.id);
		const roles = Object.fromEntries((await listMembers(asAdmin)).map((m) => [m.userId, m.role]));
		expect(roles[admin.id]).toBe('owner');
		expect(roles[owner.id]).toBe('admin');

		// A member can leave; an admin can remove a member
		await removeMember({ workspaceId, userId: plain.id, role: 'member' }, plain.id);
		expect(await getById(plain.id, workspaceId)).toBeNull();
		// Their credentials on shared connectors are revoked upstream through the connectors module
		expect(connectors.revokeUserCredentials).toHaveBeenCalledWith(workspaceId, plain.id);
	});
});

describe('invite links', () => {
	it('stores only a hash, honours max uses, email, expiry and revocation', async () => {
		const { workspaceId, actor } = await companyWithOwner();
		const { token, url, invite } = await createInviteLink(actor, { role: 'member', maxUses: 1 });
		expect(url.endsWith(`/invite/${token}`)).toBe(true);
		const [row] = await db
			.select()
			.from(workspaceInviteLink)
			.where(eq(workspaceInviteLink.id, invite.id));
		expect(row.tokenHash).not.toContain(token);
		expect(row.tokenHash).toHaveLength(64);

		const first = await seedUser(db);
		const second = await seedUser(db);
		expect((await getInvitePreview(token, first)).status).toBe('active');
		await acceptInvite(first, token);
		expect((await getById(first.id, workspaceId))?.role).toBe('member');
		expect((await getInvitePreview(token, second)).status).toBe('used');
		expect(await codeOf(acceptInvite(second, token))).toBe('INVALID_INPUT');
		// Accepting twice is harmless
		expect(await acceptInvite(first, token)).toEqual({ slug: expect.any(String) });

		const restricted = await createInviteLink(actor, {
			role: 'member',
			email: 'Boss@Example.test'
		});
		expect((await getInvitePreview(restricted.token, second)).status).toBe('email_mismatch');
		const boss = await seedUser(db, { email: 'boss@example.test' });
		await acceptInvite(boss, restricted.token);

		const revoked = await createInviteLink(actor, { role: 'member' });
		await revokeInviteLink(actor, revoked.invite.id);
		expect((await getInvitePreview(revoked.token)).status).toBe('revoked');

		const expired = await createInviteLink(actor, { role: 'member' });
		await db
			.update(workspaceInviteLink)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(workspaceInviteLink.id, expired.invite.id));
		expect((await getInvitePreview(expired.token)).status).toBe('expired');

		const statuses = (await listInviteLinks(actor)).map((i) => i.status).sort();
		expect(statuses).toEqual(['active', 'expired', 'revoked', 'used']);
		expect((await getInvitePreview('not-a-real-token-but-long-enough')).status).toBe('invalid');
	});

	it('admin invites require a second factor from the invitee', async () => {
		const { workspaceId, actor } = await companyWithOwner();
		const { token } = await createInviteLink(actor, { role: 'admin' });
		const weak = await seedUser(db);
		expect(await codeOf(acceptInvite(weak, token))).toBe('SECOND_FACTOR_REQUIRED');
		const strong = await seedUser(db, { secondFactor: true });
		await acceptInvite(strong, token);
		expect((await getById(strong.id, workspaceId))?.role).toBe('admin');
	});

	it('personal workspaces cannot invite', async () => {
		const user = await seedUser(db, { secondFactor: true });
		const actor: WorkspaceActor = {
			workspaceId: user.personalWorkspaceId,
			userId: user.id,
			role: 'owner'
		};
		expect(await codeOf(createInviteLink(actor, { role: 'member' }))).toBe('INVALID_INPUT');
	});
});

describe('admin policy', () => {
	it('normalises allowed servers and refuses non-https URLs', () => {
		expect(
			normalizeAllowedServers(['github', ' https://mcp.example.com/mcp ', 'github', ''])
		).toEqual(['github', 'https://mcp.example.com']);
		expect(normalizeAllowedServers(null)).toBeNull();
		expect(() => normalizeAllowedServers(['http://insecure.example'])).toThrow();
	});

	it('restricts members, not the admin who sets the policy', () => {
		const policy = {
			allowedServers: ['github'],
			allowPersonalConnectors: false,
			allowFreeUrls: false
		};
		const dir = { type: 'directory' as const, directoryId: 'github' };
		const url = { type: 'url' as const, url: 'https://mcp.example.com/mcp' };
		expect(checkConnectorPolicy(policy, 'member', { onlyForMe: false, source: dir }).allowed).toBe(
			false
		);
		expect(checkConnectorPolicy(policy, 'member', { onlyForMe: true, source: dir }).allowed).toBe(
			false
		);
		expect(checkConnectorPolicy(policy, 'admin', { onlyForMe: false, source: dir }).allowed).toBe(
			true
		);
		expect(checkConnectorPolicy(policy, 'admin', { onlyForMe: false, source: url }).allowed).toBe(
			false
		);
		expect(
			checkConnectorPolicy(
				{ ...policy, allowPersonalConnectors: true, allowFreeUrls: true },
				'member',
				{ onlyForMe: true, source: { type: 'directory', directoryId: 'slack' } }
			).allowed
		).toBe(false);
		expect(
			checkConnectorPolicy(
				{ allowedServers: null, allowPersonalConnectors: true, allowFreeUrls: true },
				'member',
				{ onlyForMe: true, source: url }
			).allowed
		).toBe(true);
	});

	it('only admins update it, and the change is audited without content', async () => {
		const { workspaceId, actor } = await companyWithOwner();
		const member = await seedUser(db);
		await seedMember(db, workspaceId, member.id, 'member');
		const input = {
			allowedServers: ['github'],
			allowPersonalConnectors: false,
			allowFreeUrls: false,
			permissionFloor: 'ask' as const
		};
		expect(
			await codeOf(updatePolicy({ workspaceId, userId: member.id, role: 'member' }, input))
		).toBe('FORBIDDEN');
		await updatePolicy(actor, input);
		expect(await getPolicy(workspaceId)).toMatchObject(input);
		const [event] = await db
			.select()
			.from(auditEvent)
			.where(eq(auditEvent.type, 'workspace.policy_changed'));
		expect(event.metadata).toMatchObject({ allowedServers: 1, permissionFloor: 'ask' });
	});
});

describe('active workspace per MCP connection', () => {
	it('falls back to the personal workspace and to it again when access is lost', async () => {
		const { workspaceId, actor } = await companyWithOwner();
		const user = await seedUser(db);
		await seedMember(db, workspaceId, user.id, 'member');
		// Two sign-ins of the same client: two connections
		const [first, second] = [crypto.randomUUID(), crypto.randomUUID()];
		await db.insert(mcpConnection).values([
			{ id: first, userId: user.id, clientId: 'claude' },
			{ id: second, userId: user.id, clientId: 'claude' }
		]);
		expect((await getActiveWorkspace(user.id, first)).kind).toBe('personal');
		await setActiveWorkspace(user.id, first, workspaceId);
		expect((await getActiveWorkspace(user.id, first)).id).toBe(workspaceId);
		expect((await getActiveWorkspace(user.id, second)).kind).toBe('personal');
		await removeMember(actor, user.id);
		expect((await getActiveWorkspace(user.id, first)).kind).toBe('personal');
		const stranger = await seedUser(db);
		await seedMember(db, workspaceId, stranger.id, 'member');
		// Someone else's connection is neither read nor moved
		expect((await getActiveWorkspace(stranger.id, first)).kind).toBe('personal');
		expect(await codeOf(setActiveWorkspace(stranger.id, first, workspaceId))).toBe('NOT_FOUND');
	});
});

describe('workspace deletion', () => {
	beforeEach(() => vi.useRealTimers());

	it('is owner-only, confirmed, cancellable and purged after the grace period', async () => {
		const { workspaceId, slug, actor } = await companyWithOwner();
		const admin = await seedUser(db, { secondFactor: true });
		await seedMember(db, workspaceId, admin.id, 'admin');
		const asAdmin: WorkspaceActor = { workspaceId, userId: admin.id, role: 'admin' };

		expect(await codeOf(scheduleDeletion(asAdmin, { confirm: slug }))).toBe('FORBIDDEN');
		expect(await codeOf(scheduleDeletion(actor, { confirm: 'wrong' }))).toBe('INVALID_INPUT');

		const state = await scheduleDeletion(actor, { confirm: slug });
		expect(state.purgeAt.getTime() - state.scheduledAt.getTime()).toBe(DELETION_GRACE_DAYS * DAY);
		expect(limits.cancelExecutionsInScope).toHaveBeenCalledWith({ workspaceId });
		await cancelDeletion(actor);
		expect((await getById(actor.userId, workspaceId))?.deleteScheduledAt).toBeNull();

		const again = await scheduleDeletion(actor, { confirm: slug });
		expect(await purgeScheduledDeletions(new Date(again.scheduledAt.getTime() + 6 * DAY))).toBe(0);
		expect(await getById(actor.userId, workspaceId)).not.toBeNull();
		expect(await purgeScheduledDeletions(new Date(again.purgeAt.getTime() + 1000))).toBe(1);
		expect(await db.select().from(organization).where(eq(organization.id, workspaceId))).toEqual(
			[]
		);
		const types = (
			await db.select().from(auditEvent).where(eq(auditEvent.workspaceId, workspaceId))
		).map((e) => e.type);
		expect(types).toContain('workspace.deleted');
	});
});
