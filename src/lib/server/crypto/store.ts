import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { Db } from '#lib/server/db/index.ts';
import { workspaceDataKey } from '#lib/server/db/schema/index.ts';
import type { DataKeyRecord, DataKeyStore, Resealer } from './envelope.ts';
import type { Sealed } from './types.ts';

/** `workspace_data_key` through Drizzle */
export function drizzleKeyStore(db: Db): DataKeyStore {
	const columns = {
		id: workspaceDataKey.id,
		workspaceId: workspaceDataKey.workspaceId,
		keyVersion: workspaceDataKey.keyVersion,
		wrappedKey: workspaceDataKey.wrappedKey,
		status: workspaceDataKey.status
	};
	const first = (rows: DataKeyRecord[]) => rows[0] ?? null;

	return {
		getActive: async (workspaceId) =>
			first(
				await db
					.select(columns)
					.from(workspaceDataKey)
					.where(
						and(
							eq(workspaceDataKey.workspaceId, workspaceId),
							eq(workspaceDataKey.status, 'active')
						)
					)
					.limit(1)
			),
		get: async (workspaceId, keyVersion) =>
			first(
				await db
					.select(columns)
					.from(workspaceDataKey)
					.where(
						and(
							eq(workspaceDataKey.workspaceId, workspaceId),
							eq(workspaceDataKey.keyVersion, keyVersion)
						)
					)
					.limit(1)
			),
		list: (workspaceId) =>
			db
				.select(columns)
				.from(workspaceDataKey)
				.where(eq(workspaceDataKey.workspaceId, workspaceId)),
		insertActive: async (workspaceId, keyVersion, wrappedKey) => {
			try {
				await db.transaction(async (tx) => {
					await tx
						.update(workspaceDataKey)
						.set({ status: 'retired' })
						.where(
							and(
								eq(workspaceDataKey.workspaceId, workspaceId),
								eq(workspaceDataKey.status, 'active')
							)
						);
					await tx
						.insert(workspaceDataKey)
						.values({ workspaceId, keyVersion, wrappedKey, status: 'active' });
				});
				return true;
			} catch (error) {
				// Unique (workspace, version) or one-active index: another writer got there first
				if (/UNIQUE constraint failed/i.test(String((error as Error)?.message ?? ''))) return false;
				if (/UNIQUE constraint failed/i.test(String((error as { cause?: Error })?.cause ?? ''))) {
					return false;
				}
				throw error;
			}
		},
		updateWrapped: async (id, wrappedKey) => {
			await db.update(workspaceDataKey).set({ wrappedKey }).where(eq(workspaceDataKey.id, id));
		}
	};
}

/**
 * Every sealed column group of the schema (`sealed(prefix)` in `db/schema/columns.ts`) and how
 * to scope it to one workspace. A new sealed column must be added here, or key rotation leaves
 * it on a retired data key (still readable, but never re-sealed).
 */
const SEALED_GROUPS: { table: string; prefix: string; scope: (workspaceId: string) => SQL }[] = [
	{
		table: 'connector_credential',
		prefix: 'secret',
		scope: (ws) => sql`workspace_id = ${ws}`
	},
	{
		table: 'upstream_oauth_client',
		prefix: 'client_secret',
		scope: (ws) => sql`workspace_id = ${ws}`
	},
	{ table: 'execution', prefix: 'state', scope: (ws) => sql`workspace_id = ${ws}` },
	{
		table: 'execution_call',
		prefix: 'result',
		scope: (ws) => sql`execution_id in (select id from execution where workspace_id = ${ws})`
	},
	{ table: 'approval', prefix: 'preview', scope: (ws) => sql`workspace_id = ${ws}` }
];

const BATCH = 200;

type SealedRow = { id: string; ciphertext: unknown; nonce: unknown; keyVersion: number };

const bytes = (value: unknown) =>
	value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);

export function drizzleResealer(db: Db): Resealer {
	return {
		async reseal(workspaceId, belowVersion, reseal) {
			let count = 0;
			for (const group of SEALED_GROUPS) {
				const table = sql.identifier(group.table);
				const ct = sql.identifier(`${group.prefix}_ciphertext`);
				const nonce = sql.identifier(`${group.prefix}_nonce`);
				const version = sql.identifier(`${group.prefix}_key_version`);
				let after = '';
				for (;;) {
					const rows = await db.all<SealedRow>(sql`
						select id, ${ct} as ciphertext, ${nonce} as nonce, ${version} as keyVersion
						from ${table}
						where ${group.scope(workspaceId)} and ${ct} is not null and ${version} < ${belowVersion}
							and id > ${after}
						order by id limit ${BATCH}`);
					if (rows.length === 0) break;
					for (const row of rows) {
						after = row.id;
						const sealed: Sealed = {
							ciphertext: bytes(row.ciphertext),
							nonce: bytes(row.nonce),
							keyVersion: Number(row.keyVersion)
						};
						const next = await reseal(sealed);
						// Optimistic: skip the row if it was rewritten or wiped meanwhile
						const result = await db.run(sql`
							update ${table}
							set ${ct} = ${Buffer.from(next.ciphertext)}, ${nonce} = ${Buffer.from(next.nonce)},
								${version} = ${next.keyVersion}
							where id = ${row.id} and ${version} = ${sealed.keyVersion}`);
						count += Number(result.rowsAffected ?? 0);
					}
				}
			}
			return count;
		}
	};
}

/** Workspaces that have at least one data key (the rewrap job's work list) */
export async function workspacesWithKeys(db: Db): Promise<string[]> {
	const rows = await db
		.selectDistinct({ workspaceId: workspaceDataKey.workspaceId })
		.from(workspaceDataKey);
	return rows.map((r) => r.workspaceId);
}
