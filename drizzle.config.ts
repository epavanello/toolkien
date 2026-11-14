import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL || 'file:local.db';
const local = url.startsWith('file:');

if (!local && !process.env.DATABASE_AUTH_TOKEN) throw new Error('DATABASE_AUTH_TOKEN is not set');

export default defineConfig({
	schema: './src/lib/server/db/schema/index.ts',
	out: './drizzle',
	dialect: local ? 'sqlite' : 'turso',
	dbCredentials: local ? { url } : { url, authToken: process.env.DATABASE_AUTH_TOKEN },
	verbose: true,
	strict: true
});
