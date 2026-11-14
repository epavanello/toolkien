import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '#lib/server/db/schema/index.ts';

/**
 * Test-only database for the connectors module: the current schema pushed with drizzle-kit
 * plus the FTS5 `tool_search` table from the custom migration. A temp file, not `:memory:`
 * (libSQL opens a new connection for transactions, which would see an empty memory DB).
 *
 * ```ts
 * vi.mock('#lib/server/db/index.ts', async () => {
 * 	const { createConnectorsTestDb } = await import('./testing/db.ts');
 * 	return { db: await createConnectorsTestDb() };
 * });
 * ```
 */
export async function createConnectorsTestDb() {
	const dir = mkdtempSync(join(tmpdir(), 'toolkien-connectors-'));
	const client = createClient({ url: `file:${join(dir, 'test.db')}` });
	const db = drizzle(client, { schema });
	const { pushSQLiteSchema } = await import('drizzle-kit/api');
	const { apply } = await pushSQLiteSchema(schema, db);
	await apply();
	const custom = readFileSync(
		join(process.cwd(), 'drizzle/0001_search_and_audit_guards.sql'),
		'utf8'
	);
	for (const statement of custom.split('--> statement-breakpoint')) {
		if (statement.includes('tool_search')) await client.execute(statement);
	}
	return db;
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
