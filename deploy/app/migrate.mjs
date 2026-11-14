// Applies pending Drizzle migrations (`drizzle/`) to DATABASE_URL, then exits.
// Runs before the server in the container (`Dockerfile` CMD); safe to run on every start.
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('[migrate] DATABASE_URL is not set');
	process.exit(1);
}
const client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
try {
	await migrate(drizzle(client), {
		migrationsFolder: new URL('../../drizzle', import.meta.url).pathname
	});
	console.log('[migrate] up to date');
} catch (error) {
	// Never print the URL or token; the driver's message names the failing statement only
	console.error('[migrate] failed:', error instanceof Error ? error.message : 'unknown error');
	process.exit(1);
} finally {
	client.close();
}
