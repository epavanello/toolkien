import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as schema from './schema/index.ts';
import { MIGRATIONS_FOLDER } from './testing.ts';

describe('migrations', () => {
	it('match the Drizzle schema (run `pnpm db:generate` after schema changes)', async () => {
		const meta = join(MIGRATIONS_FOLDER, 'meta');
		const latest = readdirSync(meta)
			.filter((file) => file.endsWith('_snapshot.json'))
			.sort()
			.at(-1)!;
		const snapshot = JSON.parse(readFileSync(join(meta, latest), 'utf8'));
		const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import('drizzle-kit/api');
		const current = await generateSQLiteDrizzleJson({ ...schema });
		expect(await generateSQLiteMigration(snapshot, current)).toEqual([]);
	});
});
