import * as schema from '#lib/server/db/schema/index.ts';
import { createMigratedTestDb } from '#lib/server/db/testing.ts';

/**
 * Test-only database for the connectors module: every migration applied, in a temp file.
 *
 * ```ts
 * vi.mock('#lib/server/db/index.ts', async () => {
 * 	const { createConnectorsTestDb } = await import('./testing/db.ts');
 * 	return { db: await createConnectorsTestDb() };
 * });
 * ```
 */
export async function createConnectorsTestDb() {
	return (await createMigratedTestDb('toolkien-connectors')).db;
}

/** Inserts a user, a workspace and memberships; returns their ids */
export async function seedWorkspace(
	db: Awaited<ReturnType<typeof createConnectorsTestDb>>,
	members: { id: string; role: 'owner' | 'admin' | 'member' }[],
	workspaceId = 'ws-1'
) {
	const now = new Date();
	for (const m of members) {
		await db
			.insert(schema.user)
			.values({
				id: m.id,
				name: m.id,
				email: `${m.id}@example.com`,
				emailVerified: true,
				createdAt: now,
				updatedAt: now
			} as never)
			.onConflictDoNothing();
	}
	await db
		.insert(schema.organization)
		.values({
			id: workspaceId,
			name: workspaceId,
			slug: workspaceId,
			createdAt: now,
			kind: 'company'
		} as never)
		.onConflictDoNothing();
	for (const m of members) {
		await db
			.insert(schema.member)
			.values({
				id: `${workspaceId}-${m.id}`,
				organizationId: workspaceId,
				userId: m.id,
				role: m.role,
				createdAt: now
			} as never)
			.onConflictDoNothing();
	}
	return workspaceId;
}
