/**
 * Test support for the execution vertical (permissions, bridge, executions specs). Never
 * imported by app code: a throwaway libSQL file database with the real migrations, a fake
 * workspace crypto that still binds ciphertexts to the workspace, and seed helpers.
 */
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { randomUUID } from 'node:crypto';
import type { Db } from '#lib/server/db/index.ts';
import * as schema from '#lib/server/db/schema/index.ts';
import { createMigratedTestDb } from '#lib/server/db/testing.ts';
import type { ToolAnnotations, WorkspaceRole } from '#lib/server/db/schema/index.ts';
import type { Sealed, WorkspaceCrypto } from '#lib/server/crypto/types.ts';

export type TestDb = { db: Db; url: string; reopen: () => Db; cleanup: () => void };

/**
 * A fresh database file with every migration applied (FTS5, audit trigger). `reopen` returns a
 * new connection: it simulates a process restart.
 */
export async function createTestDb(): Promise<TestDb> {
	const test = await createMigratedTestDb('toolkien-executions');
	const open = () => drizzle(createClient({ url: test.url }), { schema }) as unknown as Db;
	return {
		db: test.db as unknown as Db,
		url: test.url,
		reopen: open,
		cleanup: test.cleanup
	};
}

/**
 * Reversible, workspace-bound "encryption" for tests: the payload is reversed and base64'd so the
 * plaintext never appears in the database, and opening it with another workspace id throws.
 */
export const fakeCrypto: Pick<
	WorkspaceCrypto,
	'encryptJsonForWorkspace' | 'decryptJsonForWorkspace'
> = {
	async encryptJsonForWorkspace(workspaceId: string, value: unknown): Promise<Sealed> {
		const text = JSON.stringify({ w: workspaceId, v: value });
		const ciphertext = Buffer.from(
			Buffer.from(text, 'utf8').toString('base64').split('').reverse().join('')
		);
		return { ciphertext, nonce: Buffer.alloc(12), keyVersion: 1 };
	},
	async decryptJsonForWorkspace<T>(workspaceId: string, sealed: Sealed): Promise<T> {
		const reversed = Buffer.from(sealed.ciphertext).toString().split('').reverse().join('');
		const parsed = JSON.parse(Buffer.from(reversed, 'base64').toString('utf8'));
		if (parsed.w !== workspaceId) throw new Error('Associated data mismatch');
		return parsed.v as T;
	}
};

export async function seedUser(db: Db, id = randomUUID()) {
	await db.insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
	return id;
}

export async function seedWorkspace(
	db: Db,
	opts: { id?: string; name?: string; kind?: 'personal' | 'company' } = {}
) {
	const id = opts.id ?? randomUUID();
	await db.insert(schema.organization).values({
		id,
		name: opts.name ?? `Workspace ${id.slice(0, 4)}`,
		slug: `ws-${id}`,
		kind: opts.kind ?? 'company',
		createdAt: new Date()
	});
	return id;
}

export async function seedMember(db: Db, workspaceId: string, userId: string, role: WorkspaceRole) {
	await db.insert(schema.member).values({
		id: randomUUID(),
		organizationId: workspaceId,
		userId,
		role,
		createdAt: new Date()
	});
}

export async function seedConnector(
	db: Db,
	workspaceId: string,
	opts: {
		namespace?: string;
		name?: string;
		source?: 'directory' | 'url';
		ownerUserId?: string | null;
	} = {}
) {
	const id = randomUUID();
	const namespace = opts.namespace ?? `ns${id.slice(0, 6).replace(/-/g, '')}`;
	await db.insert(schema.connector).values({
		id,
		workspaceId,
		scope: 'shared',
		ownerUserId: opts.ownerUserId ?? null,
		source: opts.source ?? 'directory',
		url: `https://${namespace}.example.test/mcp`,
		name: opts.name ?? namespace,
		namespace,
		unverified: (opts.source ?? 'directory') === 'url',
		authType: 'none',
		status: 'active'
	});
	return { id, namespace };
}

export async function seedTool(
	db: Db,
	workspaceId: string,
	connectorId: string,
	opts: { path: string; annotations?: ToolAnnotations | null; signatureHash?: string }
) {
	const id = randomUUID();
	await db.insert(schema.tool).values({
		id,
		workspaceId,
		connectorId,
		upstreamName: opts.path.split('.').pop() ?? opts.path,
		path: opts.path,
		currentVersion: 1
	});
	await db.insert(schema.toolVersion).values({
		toolId: id,
		version: 1,
		inputSchema: { type: 'object' },
		annotations: opts.annotations ?? null,
		signatureHash: opts.signatureHash ?? 'sig-1'
	});
	return id;
}

/** Saves a new tool version (signature change after a refresh) */
export async function bumpToolSignature(
	db: Db,
	toolId: string,
	signatureHash: string,
	annotations: ToolAnnotations | null = null
) {
	await db.insert(schema.toolVersion).values({
		toolId,
		version: 2,
		inputSchema: { type: 'object', properties: { extra: { type: 'string' } } },
		annotations,
		signatureHash
	});
	await db.update(schema.tool).set({ currentVersion: 2 }).where(eq(schema.tool.id, toolId));
}
