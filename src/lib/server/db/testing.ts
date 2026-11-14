/**
 * Test-only database: a temp-file libSQL database with every migration in `drizzle/` applied,
 * the same path dev (`pnpm db:migrate`) and production (`deploy/app/migrate.mjs`) take. A file,
 * not `:memory:`: libSQL opens a new connection per transaction, which would see an empty
 * memory database.
 */
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as schema from './schema/index.ts';

export const MIGRATIONS_FOLDER = join(process.cwd(), 'drizzle');

export async function createMigratedTestDb(prefix = 'toolkien-test') {
	const dir = mkdtempSync(join(tmpdir(), `${prefix}-`));
	const url = `file:${join(dir, 'test.db')}`;
	const client = createClient({ url });
	const db = drizzle(client, { schema });
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
	return {
		client,
		db,
		url,
		cleanup: () => {
			client.close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}
