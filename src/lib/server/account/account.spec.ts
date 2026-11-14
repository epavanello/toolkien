import { describe, expect, it, vi } from 'vitest';

vi.mock('#lib/server/db/index.ts', async () => {
	const { createTestDb } = await import('#lib/server/workspaces/test-db.ts');
	return { db: await createTestDb() };
});
const removed: string[] = [];
vi.mock('#lib/server/connectors/index.ts', async () => {
	const { db } = await import('#lib/server/db/index.ts');
	const { connector } = await import('#lib/server/db/schema/index.ts');
	const { eq } = await import('drizzle-orm');
	return {
		remove: vi.fn(async (_actor: unknown, id: string) => {
			removed.push(id);
			await db.delete(connector).where(eq(connector.id, id));
		})
	};
});

import { eq } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import { auditEvent, connector, organization, user } from '#lib/server/db/schema/index.ts';
import { createWorkspace } from '#lib/server/workspaces/index.ts';
import { seedMember, seedUser } from '#lib/server/workspaces/test-db.ts';
import { deleteAccount, deletionBlockers, exportAccount } from './index.ts';

const codeOf = (promise: Promise<unknown>) =>
	promise.then(
		() => 'resolved',
		(e: { body?: { code?: string } }) => e.body?.code ?? 'unknown'
	);

async function addConnector(workspaceId: string, ownerUserId: string | null) {
	const [row] = await db
		.insert(connector)
		.values({
			workspaceId,
			ownerUserId,
			scope: 'personal',
			source: 'directory',
			url: 'https://mcp.example.com',
			name: 'Mail',
			namespace: `mail${crypto.randomUUID().slice(0, 4)}`,
			authType: 'oauth'
		})
		.returning();
	return row;
}

describe('account export', () => {
	it('contains metadata only and is audited', async () => {
		const me = await seedUser(db, { name: 'Me' });
		await addConnector(me.personalWorkspaceId, me.id);
		const data = await exportAccount(me.id);
		expect(data.account.email).toBe(me.email);
		expect(data.workspaces).toHaveLength(1);
		expect(data.connectors).toHaveLength(1);
		expect(JSON.stringify(data)).not.toMatch(/ciphertext|password|secret/i);
		const events = await db.select().from(auditEvent).where(eq(auditEvent.userId, me.id));
		expect(events.map((e) => e.type)).toContain('account.exported');
	});
});

describe('account deletion', () => {
	it('is blocked while the user owns a company workspace with other members', async () => {
		const owner = await seedUser(db, { secondFactor: true });
		const { id } = await createWorkspace(owner.id, { name: 'Team' });
		const other = await seedUser(db);
		await seedMember(db, id, other.id, 'member');
		expect((await deletionBlockers(owner.id)).map((b) => b.workspaceId)).toEqual([id]);
		expect(await codeOf(deleteAccount(owner.id))).toBe('CONFLICT');
	});

	it('deletes owned workspaces, revokes connectors, anonymises remaining logs', async () => {
		const me = await seedUser(db, { secondFactor: true });
		const { id: solo } = await createWorkspace(me.id, { name: 'Solo' });
		const boss = await seedUser(db, { secondFactor: true });
		const { id: team } = await createWorkspace(boss.id, { name: 'Team' });
		await seedMember(db, team, me.id, 'member');

		const personalConnector = await addConnector(me.personalWorkspaceId, me.id);
		const teamConnector = await addConnector(team, me.id);
		const sharedConnector = await addConnector(team, null);
		await record({ type: 'tool.called', outcome: 'success', workspaceId: team, userId: me.id });
		await record({
			type: 'auth.login',
			outcome: 'success',
			workspaceId: me.personalWorkspaceId,
			userId: me.id
		});

		await deleteAccount(me.id);

		expect(await db.select().from(user).where(eq(user.id, me.id))).toEqual([]);
		for (const id of [solo, me.personalWorkspaceId]) {
			expect(await db.select().from(organization).where(eq(organization.id, id))).toEqual([]);
			expect(await db.select().from(auditEvent).where(eq(auditEvent.workspaceId, id))).toEqual([]);
		}
		expect(removed).toEqual(expect.arrayContaining([personalConnector.id, teamConnector.id]));
		expect(removed).not.toContain(sharedConnector.id);
		const teamEvents = await db.select().from(auditEvent).where(eq(auditEvent.workspaceId, team));
		expect(teamEvents.find((e) => e.type === 'tool.called')?.userId).toBeNull();
		expect(await db.select().from(auditEvent).where(eq(auditEvent.userId, me.id))).toEqual([]);
	});
});
