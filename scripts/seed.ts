/**
 * Development only: fills the local database with users, workspaces and a synced connector to
 * the local dev MCP server. Idempotent (fixed ids, existing rows are left alone).
 *
 *   pnpm db:seed            # DATABASE_URL from the environment, default file:local.db
 *   pnpm db:reset           # delete local.db, migrate, seed
 *
 * Sign in with any seeded email: without RESEND_API_KEY the code and link are printed to the
 * `pnpm dev` console. Add alice@toolkien.test to PLATFORM_ADMIN_EMAILS for `/admin`.
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from '../src/lib/server/db/schema/index.ts';
import { searchText } from '../src/lib/server/connectors/search.ts';
import { signatureHash, toCamelCase } from '../src/lib/server/typegen/index.ts';
import { DEV_MCP_URL, DEV_TOOLS } from './dev-mcp-tools.ts';

const url = process.env.DATABASE_URL || 'file:local.db';
if (!url.startsWith('file:')) {
	console.error(`Refusing to seed a non-local database (${url})`);
	process.exit(1);
}

const db = drizzle(createClient({ url }), { schema });
const now = new Date();

const USERS = [
	{ id: 'seed-alice', name: 'Alice Admin', email: 'alice@toolkien.test' },
	{ id: 'seed-bob', name: 'Bob Builder', email: 'bob@toolkien.test' },
	{ id: 'seed-carol', name: 'Carol Member', email: 'carol@toolkien.test' }
] as const;

const ACME = { id: 'seed-ws-acme', name: 'Acme', slug: 'acme' };
const ACME_ROLES = { 'seed-alice': 'owner', 'seed-bob': 'admin', 'seed-carol': 'member' } as const;

const personalId = (userId: string) => `${userId}-personal`;
// Same rule as `personalSlug` in `src/lib/server/personal-workspace.ts`
const personalSlug = (userId: string) =>
	`personal-${userId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

async function seedUsers() {
	for (const u of USERS) {
		await db
			.insert(schema.user)
			.values({ ...u, emailVerified: true, createdAt: now, updatedAt: now })
			.onConflictDoNothing();
		const workspaceId = personalId(u.id);
		await db
			.insert(schema.organization)
			.values({
				id: workspaceId,
				name: 'Personal',
				slug: personalSlug(u.id),
				kind: 'personal',
				createdAt: now
			})
			.onConflictDoNothing();
		await db
			.insert(schema.member)
			.values({
				id: `${workspaceId}-${u.id}`,
				organizationId: workspaceId,
				userId: u.id,
				role: 'owner',
				createdAt: now
			})
			.onConflictDoNothing();
		await db.insert(schema.workspacePolicy).values({ workspaceId }).onConflictDoNothing();
	}
}

async function seedCompany() {
	await db
		.insert(schema.organization)
		.values({ ...ACME, kind: 'company', createdAt: now })
		.onConflictDoNothing();
	for (const [userId, role] of Object.entries(ACME_ROLES)) {
		await db
			.insert(schema.member)
			.values({
				id: `${ACME.id}-${userId}`,
				organizationId: ACME.id,
				userId,
				role,
				createdAt: now
			})
			.onConflictDoNothing();
	}
	await db
		.insert(schema.workspacePolicy)
		.values({ workspaceId: ACME.id, updatedBy: 'seed-alice' })
		.onConflictDoNothing();
}

/** A shared, no-auth connector to `scripts/dev-mcp.ts`, with its tools as a sync would save them */
async function seedDevConnector(workspaceId: string, createdBy: string) {
	const conn = {
		id: `${workspaceId}-devmcp`,
		workspaceId,
		scope: 'shared' as const,
		source: 'url' as const,
		url: DEV_MCP_URL,
		name: 'Dev MCP',
		namespace: 'devMcp',
		unverified: true,
		authType: 'none' as const,
		status: 'active' as const,
		lastSyncedAt: now,
		serverInfo: { name: 'toolkien-dev-mcp', version: '1.0.0' },
		createdBy
	};
	const inserted = await db
		.insert(schema.connector)
		.values(conn)
		.onConflictDoNothing()
		.returning({ id: schema.connector.id });
	if (inserted.length === 0) return;

	for (const t of DEV_TOOLS) {
		const toolId = `${conn.id}-${t.name}`;
		const path = `${conn.namespace}.${toCamelCase(t.name)}`;
		const annotations = t.annotations ?? null;
		await db.insert(schema.tool).values({
			id: toolId,
			workspaceId,
			connectorId: conn.id,
			upstreamName: t.name,
			path,
			currentVersion: 1
		});
		await db.insert(schema.toolVersion).values({
			toolId,
			version: 1,
			title: t.title,
			description: t.description,
			inputSchema: t.inputSchema,
			outputSchema: t.outputSchema ?? null,
			annotations,
			signatureHash: signatureHash({
				inputSchema: t.inputSchema,
				outputSchema: t.outputSchema ?? null,
				annotations
			})
		});
		await db.insert(schema.toolSearchText).values({
			toolId,
			workspaceId,
			connectorId: conn.id,
			text: searchText({
				path,
				namespace: conn.namespace,
				upstreamName: t.name,
				connectorName: conn.name,
				label: null,
				title: t.title,
				description: t.description
			})
		});
	}
}

await seedUsers();
await seedCompany();
await seedDevConnector(ACME.id, 'seed-alice');
await seedDevConnector(personalId('seed-alice'), 'seed-alice');

console.info(`Seeded ${url}
  users:      ${USERS.map((u) => u.email).join(', ')}
  workspaces: Personal ×${USERS.length}, ${ACME.name} (/${ACME.slug}: alice owner, bob admin, carol member)
  connector:  "Dev MCP" → ${DEV_MCP_URL} in Acme and in Alice's personal workspace
              (run \`pnpm dev:mcp\` to serve it)`);
