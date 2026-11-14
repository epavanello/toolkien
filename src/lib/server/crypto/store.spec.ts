import { createClient } from '@libsql/client';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '#lib/server/db/schema/index.ts';
import type { Db } from '#lib/server/db/index.ts';
import { createEnvelopeCrypto } from './envelope.ts';
import { drizzleKeyStore, drizzleResealer, SEALED_GROUPS, workspacesWithKeys } from './store.ts';
import { devWrapper } from './wrappers.ts';

const MASTER = Buffer.alloc(32, 3).toString('base64');

let db: Db;
let dir: string;

beforeEach(async () => {
	// A file, not `:memory:`: libSQL opens a new connection per transaction
	dir = mkdtempSync(join(tmpdir(), 'toolkien-crypto-'));
	const client = createClient({ url: `file:${join(dir, 'test.db')}` });
	db = drizzle(client, { schema }) as unknown as Db;
	await migrate(db, { migrationsFolder: 'drizzle' });
	const now = Date.now();
	await db.run(sql`insert into organization (id, name, slug, created_at)
		values ('ws', 'A', 'a', ${now}), ('other', 'B', 'b', ${now})`);
	await db.run(sql`insert into user (id, name, email, created_at, updated_at)
		values ('u', 'U', 'u@example.com', ${now}, ${now})`);
	await db.run(sql`insert into connector (id, workspace_id, scope, source, url, name, namespace, auth_type)
		values ('conn', 'ws', 'workspace', 'custom', 'https://a.example', 'A', 'a', 'none'),
		('conn2', 'other', 'workspace', 'custom', 'https://b.example', 'B', 'b', 'none')`);
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const crypto = () =>
	createEnvelopeCrypto({
		wrapper: devWrapper(MASTER),
		store: drizzleKeyStore(db),
		resealer: drizzleResealer(db)
	});

describe('drizzle key store', () => {
	it('keeps exactly one active key per workspace and refuses duplicate versions', async () => {
		const store = drizzleKeyStore(db);
		expect(await store.insertActive('ws', 1, 'dev:v1:a')).toBe(true);
		expect(await store.insertActive('other', 1, 'dev:v1:z')).toBe(true);
		expect(await store.insertActive('ws', 1, 'dev:v1:b')).toBe(false);
		expect(await store.insertActive('ws', 2, 'dev:v1:c')).toBe(true);
		expect((await store.getActive('ws'))?.keyVersion).toBe(2);
		expect((await store.get('ws', 1))?.status).toBe('retired');
		expect((await workspacesWithKeys(db)).sort()).toEqual(['other', 'ws']);
	});

	it('re-seals every sealed column of a workspace on data key rotation', async () => {
		const c = crypto();
		const s = await c.encryptJsonForWorkspace('ws', { accessToken: 'tok' });
		const foreign = await crypto().encryptForWorkspace('other', 'keep');
		await db.run(sql`insert into connector_credential
			(id, connector_id, workspace_id, kind, secret_ciphertext, secret_nonce, secret_key_version)
			values ('cred', 'conn', 'ws', 'oauth', ${Buffer.from(s.ciphertext)}, ${Buffer.from(s.nonce)}, ${s.keyVersion}),
			('cred2', 'conn2', 'other', 'oauth', ${Buffer.from(foreign.ciphertext)}, ${Buffer.from(foreign.nonce)}, ${foreign.keyVersion})`);
		const state = await c.encryptForWorkspace('ws', 'code');
		await db.run(sql`insert into execution (id, workspace_id, user_id, code_hash, state_ciphertext, state_nonce, state_key_version)
			values ('exe', 'ws', 'u', 'h', ${Buffer.from(state.ciphertext)}, ${Buffer.from(state.nonce)}, ${state.keyVersion})`);
		const result = await c.encryptForWorkspace('ws', 'result');
		await db.run(sql`insert into execution_call (id, execution_id, seq, path, is_write, result_ciphertext, result_nonce, result_key_version)
			values ('call', 'exe', 1, 'a.b', 0, ${Buffer.from(result.ciphertext)}, ${Buffer.from(result.nonce)}, ${result.keyVersion})`);

		expect(await c.rewrap('ws', { rotateDataKey: true })).toEqual({ resealed: 3 });

		const row = (
			await db.all<{ ct: ArrayBuffer; nonce: ArrayBuffer; v: number }>(
				sql`select secret_ciphertext ct, secret_nonce nonce, secret_key_version v from connector_credential where id = 'cred'`
			)
		)[0]!;
		expect(row.v).toBe(2);
		const fresh = crypto();
		expect(
			await fresh.decryptJsonForWorkspace('ws', {
				ciphertext: new Uint8Array(row.ct),
				nonce: new Uint8Array(row.nonce),
				keyVersion: row.v
			})
		).toEqual({ accessToken: 'tok' });
		const untouched = await db.all<{ v: number }>(
			sql`select secret_key_version v from connector_credential where id = 'cred2'`
		);
		expect(untouched[0]!.v).toBe(1);
		// Idempotent: nothing left on the old version
		expect(await c.rewrap('ws', { rotateDataKey: false })).toEqual({ resealed: 0 });
	});
});

describe('SEALED_GROUPS', () => {
	it('covers every sealed column of the schema', () => {
		const inSchema = (Object.values(schema) as unknown[])
			.filter((value): value is SQLiteTable => value instanceof SQLiteTable)
			.flatMap((table) => {
				const config = getTableConfig(table);
				return config.columns
					.filter((column) => column.name.endsWith('_ciphertext'))
					.map((column) => `${config.name}.${column.name.replace(/_ciphertext$/, '')}`);
			})
			.sort();
		const covered = SEALED_GROUPS.map((group) => `${group.table}.${group.prefix}`).sort();
		expect(covered).toEqual(inSchema);
	});
});
