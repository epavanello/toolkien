import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { DATABASE_AUTH_TOKEN, DATABASE_URL } from '$app/env/private';
import * as schema from './schema/index.ts';

const client = createClient({ url: DATABASE_URL, authToken: DATABASE_AUTH_TOKEN });

export const db = drizzle(client, { schema });
export type Db = typeof db;
/** A transaction handle; functions that must join the caller's transaction accept `Db | Tx` */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
