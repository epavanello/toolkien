import * as schema from '#lib/server/db/schema/index.ts';
import { createMigratedTestDb } from '#lib/server/db/testing.ts';

/**
 * Test-only: a fresh database with every migration applied (audit append-only trigger
 * included). Use it with `vi.mock('#lib/server/db/index.ts', ...)`:
 *
 * ```ts
 * vi.mock('#lib/server/db/index.ts', async () => {
 * 	const { createTestDb } = await import('#lib/server/workspaces/test-db.ts');
 * 	return { db: await createTestDb() };
 * });
 * ```
 */
export async function createTestDb() {
	return (await createMigratedTestDb('toolkien-workspaces')).db;
}

type TestDb = Awaited<ReturnType<typeof createTestDb>>;

/** Test-only: a user (with a passkey when `secondFactor`) and their personal workspace */
export async function seedUser(
	db: TestDb,
	options: { name?: string; email?: string; secondFactor?: boolean } = {}
) {
	const id = crypto.randomUUID();
	const name = options.name ?? `User ${id.slice(0, 4)}`;
	const email = options.email ?? `${id.slice(0, 8)}@example.test`;
	await db.insert(schema.user).values({ id, name, email });
	if (options.secondFactor) {
		await db.insert(schema.passkey).values({
			id: crypto.randomUUID(),
			publicKey: 'test',
			userId: id,
			credentialID: crypto.randomUUID(),
			counter: 0,
			deviceType: 'singleDevice',
			backedUp: false
		});
	}
	const workspaceId = crypto.randomUUID();
	await db.batch([
		db.insert(schema.organization).values({
			id: workspaceId,
			name: 'Personal',
			slug: `personal-${id.replace(/-/g, '')}`,
			kind: 'personal',
			createdAt: new Date()
		}),
		db.insert(schema.member).values({
			id: crypto.randomUUID(),
			organizationId: workspaceId,
			userId: id,
			role: 'owner',
			createdAt: new Date()
		})
	]);
	return { id, name, email, personalWorkspaceId: workspaceId };
}

/** Test-only: adds a membership row */
export async function seedMember(
	db: TestDb,
	workspaceId: string,
	userId: string,
	role: 'owner' | 'admin' | 'member'
) {
	await db.insert(schema.member).values({
		id: crypto.randomUUID(),
		organizationId: workspaceId,
		userId,
		role,
		createdAt: new Date()
	});
}
