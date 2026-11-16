import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db, type Tx } from '#lib/server/db/index.ts';
import { connector, tool, toolSearchText, toolVersion } from '#lib/server/db/schema/index.ts';
import { signatureHash, toCamelCase, uniqueName } from '#lib/server/typegen/index.ts';
import type { ConnectorRow } from './access.ts';
import { detectAuth } from './detect.ts';
import { getDirectoryEntry } from './directory.ts';
import { searchText } from './search.ts';
import { upstreamCredential } from './session.ts';
import type { CatalogChanges, SyncReason, SyncResult, ToolAnnotations } from './types.ts';
import { listTools, UpstreamError, type SessionInfo, type UpstreamTool } from './upstream.ts';

/**
 * `tools/list` → versioned definitions. Paths stay stable across syncs (a tool keeps its path
 * while its upstream name exists); new names get the first free camelCase name in the
 * connector. A version is saved whenever schema, annotations, title or description change;
 * permissions compare their confirmed hash with the current version's, so a changed signature
 * is "to confirm" without touching permission rows. The `tool_search_text` rows of the
 * connector are rebuilt in the same transaction.
 *
 * Syncs nobody watches (every reason but `manual`) that change the catalog of a connector
 * synced before add their result to `connector.pending_changes`, shown to managers until they
 * review it; the first load of a catalog is not news.
 */

/** Verified directory annotations override what the server reports */
export function mergeAnnotations(
	upstream: ToolAnnotations | null,
	verified: ToolAnnotations | undefined
): ToolAnnotations | null {
	if (!verified) return upstream;
	return { ...(upstream ?? {}), ...verified };
}

type ExistingTool = typeof tool.$inferSelect & { version: typeof toolVersion.$inferSelect | null };

async function existingTools(connectorId: string): Promise<ExistingTool[]> {
	const rows = await db
		.select({ tool, version: toolVersion })
		.from(tool)
		.leftJoin(
			toolVersion,
			and(eq(toolVersion.toolId, tool.id), eq(toolVersion.version, tool.currentVersion))
		)
		.where(eq(tool.connectorId, connectorId));
	return rows.map((row) => ({ ...row.tool, version: row.version }));
}

export const isCatalogChange = (result: SyncResult) =>
	result.added + result.updated + result.removed > 0;

/** `previous` plus one more sync's changes: counts add up, paths are deduplicated */
export function mergeChanges(
	previous: CatalogChanges | null,
	result: SyncResult,
	at: Date
): CatalogChanges {
	const union = (a: string[] = [], b: string[]) => [...new Set([...a, ...b])];
	return {
		since: previous?.since ?? at.toISOString(),
		added: (previous?.added ?? 0) + result.added,
		updated: (previous?.updated ?? 0) + result.updated,
		removed: (previous?.removed ?? 0) + result.removed,
		signatureChanged: union(previous?.signatureChanged, result.signatureChanged),
		descriptionChanged: union(previous?.descriptionChanged, result.descriptionChanged)
	};
}

/**
 * Applies a `tools/list` result; pure database work, no network. `notify`: keep the changes
 * as `pending_changes` (background syncs).
 */
export async function applyToolList(
	conn: ConnectorRow,
	upstreamTools: UpstreamTool[],
	info: SessionInfo,
	opts: { notify?: boolean } = {}
): Promise<SyncResult> {
	const entry = conn.source === 'directory' ? getDirectoryEntry(conn.directoryId) : null;
	const existing = await existingTools(conn.id);
	const byName = new Map(existing.map((t) => [t.upstreamName, t]));
	const listed = [...new Map(upstreamTools.map((t) => [t.name, t])).values()].sort((a, b) =>
		a.name < b.name ? -1 : 1
	);
	const result: SyncResult = {
		added: 0,
		updated: 0,
		removed: 0,
		signatureChanged: [],
		descriptionChanged: []
	};
	const now = new Date();

	// Function names already owned by tools that keep their path
	const taken = new Set(
		existing
			.filter((t) => listed.some((l) => l.name === t.upstreamName))
			.map((t) => t.path.slice(conn.namespace.length + 1))
	);

	await db.transaction(async (tx) => {
		const keep = new Set<string>();
		for (const upstream of listed) {
			const annotations = mergeAnnotations(
				upstream.annotations,
				entry?.annotations?.[upstream.name]
			);
			const hash = signatureHash({
				inputSchema: upstream.inputSchema,
				outputSchema: upstream.outputSchema,
				annotations
			});
			const definition = {
				title: upstream.title,
				description: upstream.description,
				inputSchema: upstream.inputSchema,
				outputSchema: upstream.outputSchema,
				annotations,
				signatureHash: hash
			};
			const current = byName.get(upstream.name);
			if (!current) {
				const fn = uniqueName(toCamelCase(upstream.name), taken);
				taken.add(fn);
				const [row] = await tx
					.insert(tool)
					.values({
						workspaceId: conn.workspaceId,
						connectorId: conn.id,
						upstreamName: upstream.name,
						path: `${conn.namespace}.${fn}`,
						currentVersion: 1
					})
					.returning();
				await tx.insert(toolVersion).values({ toolId: row.id, version: 1, ...definition });
				keep.add(row.id);
				result.added++;
				continue;
			}
			keep.add(current.id);
			const previous = current.version;
			const signatureDiffers = previous?.signatureHash !== hash;
			const descriptionDiffers = (previous?.description ?? null) !== upstream.description;
			const changed =
				!previous ||
				signatureDiffers ||
				descriptionDiffers ||
				(previous.title ?? null) !== upstream.title ||
				JSON.stringify(previous.annotations ?? null) !== JSON.stringify(annotations);
			if (changed) {
				const version = current.currentVersion + (previous ? 1 : 0);
				await tx.insert(toolVersion).values({ toolId: current.id, version, ...definition });
				await tx
					.update(tool)
					.set({ currentVersion: version, removedAt: null, updatedAt: now })
					.where(eq(tool.id, current.id));
				if (previous && signatureDiffers) result.signatureChanged.push(current.path);
				if (previous && descriptionDiffers) result.descriptionChanged.push(current.path);
			} else if (current.removedAt) {
				await tx
					.update(tool)
					.set({ removedAt: null, updatedAt: now })
					.where(eq(tool.id, current.id));
			}
			if (current.removedAt) result.added++;
			else if (changed) result.updated++;
		}

		const gone = existing.filter((t) => !keep.has(t.id) && !t.removedAt).map((t) => t.id);
		if (gone.length > 0) {
			await tx.update(tool).set({ removedAt: now, updatedAt: now }).where(inArray(tool.id, gone));
			result.removed = gone.length;
		}

		await rebuildSearch(tx, conn);

		// Read inside the transaction (`conn` may be an old copy; another background sync may
		// have added changes meanwhile)
		const [current] =
			opts.notify && isCatalogChange(result)
				? await tx
						.select({
							lastSyncedAt: connector.lastSyncedAt,
							pendingChanges: connector.pendingChanges
						})
						.from(connector)
						.where(eq(connector.id, conn.id))
				: [];
		const notify = current !== undefined && current.lastSyncedAt !== null;
		await tx
			.update(connector)
			.set({
				status: 'active',
				statusMessage: null,
				lastSyncedAt: now,
				protocolVersion: info.protocolVersion,
				serverInfo: info.serverInfo,
				toolsListChanged: info.toolsListChanged,
				...(notify ? { pendingChanges: mergeChanges(current.pendingChanges, result, now) } : {})
			})
			.where(eq(connector.id, conn.id));
	});
	return result;
}

/**
 * Rebuilds the search rows of a connector's live tools (sync, rename). The text includes the
 * connector name and instance label so two instances of one server are told apart.
 */
export async function rebuildSearch(
	tx: Tx,
	conn: Pick<
		ConnectorRow,
		'id' | 'workspaceId' | 'name' | 'label' | 'namespace' | 'source' | 'directoryId'
	>
) {
	await tx.delete(toolSearchText).where(eq(toolSearchText.connectorId, conn.id));
	const live = await tx
		.select({
			id: tool.id,
			path: tool.path,
			upstreamName: tool.upstreamName,
			title: toolVersion.title,
			description: toolVersion.description
		})
		.from(tool)
		.innerJoin(
			toolVersion,
			and(eq(toolVersion.toolId, tool.id), eq(toolVersion.version, tool.currentVersion))
		)
		.where(and(eq(tool.connectorId, conn.id), isNull(tool.removedAt)));
	if (live.length === 0) return;
	const tags = conn.source === 'directory' ? (getDirectoryEntry(conn.directoryId)?.tags ?? []) : [];
	await tx.insert(toolSearchText).values(
		live.map((row) => ({
			toolId: row.id,
			workspaceId: conn.workspaceId,
			connectorId: conn.id,
			text: searchText({
				...row,
				namespace: conn.namespace,
				connectorName: conn.name,
				label: conn.label,
				tags
			})
		}))
	);
}

/**
 * Self-healing of a connector saved with `authType = 'none'` whose server answers 401 (wrong
 * guess, or the server started requiring sign-in): re-detects the authentication (OAuth when
 * the server publishes metadata, else a token; the directory's type when it names one) and
 * moves the connector to `pending_auth`. Returns the new type.
 */
export async function requireAuthentication(
	conn: ConnectorRow,
	actorUserId: string | null
): Promise<Exclude<ConnectorRow['authType'], 'none'>> {
	const entry = conn.source === 'directory' ? getDirectoryEntry(conn.directoryId) : null;
	const detected = await detectAuth(conn.url, { fallback: 'token' });
	const authType =
		detected.authType === 'oauth' ? 'oauth' : entry?.authType === 'oauth' ? 'oauth' : 'token';
	const updated = await db
		.update(connector)
		.set({ authType, status: 'pending_auth', statusMessage: null })
		.where(and(eq(connector.id, conn.id), eq(connector.authType, 'none')))
		.returning({ id: connector.id });
	if (updated.length > 0) {
		await record({
			type: 'connector.synced',
			outcome: 'success',
			workspaceId: conn.workspaceId,
			userId: actorUserId,
			connectorId: conn.id,
			metadata: { reason: 'auth_detected', authType, via: detected.via }
		});
	}
	return authType;
}

const inflight = new Map<string, Promise<SyncResult>>();

/** Reloads the connector's tools with the credential of `credentialUserId` (`null` = shared) */
export function syncConnector(
	conn: ConnectorRow,
	credentialUserId: string | null,
	reason: SyncReason,
	actorUserId: string | null
): Promise<SyncResult> {
	const key = `${conn.id}:${credentialUserId ?? ''}`;
	const running = inflight.get(key);
	if (running) return running;
	const promise = runSync(conn, credentialUserId, reason, actorUserId).finally(() =>
		inflight.delete(key)
	);
	inflight.set(key, promise);
	return promise;
}

async function fetchTools(conn: ConnectorRow, credentialUserId: string | null) {
	const credential = await upstreamCredential(conn, credentialUserId);
	if (credential === 'missing') throw new UpstreamError('auth_required', 'Not connected yet.');
	try {
		return await listTools({ url: conn.url, credential });
	} catch (cause) {
		if (!(cause instanceof UpstreamError) || cause.code !== 'auth_required' || !credential)
			throw cause;
		// The access token may have been revoked or expired early: refresh once and retry
		const refreshed = await upstreamCredential(conn, credentialUserId, { forceRefresh: true });
		if (refreshed === 'missing' || !refreshed) throw cause;
		return listTools({ url: conn.url, credential: refreshed });
	}
}

async function runSync(
	conn: ConnectorRow,
	credentialUserId: string | null,
	reason: SyncReason,
	actorUserId: string | null
): Promise<SyncResult> {
	if (conn.suspendedAt) error(409, 'This connector is suspended.', { code: 'SUSPENDED' });
	let listed: Awaited<ReturnType<typeof listTools>>;
	try {
		listed = await fetchTools(conn, credentialUserId);
	} catch (cause) {
		const upstream =
			cause instanceof UpstreamError
				? cause
				: new UpstreamError('unreachable', 'Could not talk to the MCP server.');
		// Added without authentication but the server wants it: switch to the detected type so
		// the user gets a Connect button instead of a stuck connector
		const required =
			upstream.code === 'auth_required' && conn.authType === 'none'
				? await requireAuthentication(conn, actorUserId)
				: null;
		// Personal credentials fail per user: only shared failures change the connector status
		if (!required && (credentialUserId === null || conn.authType === 'none')) {
			await db
				.update(connector)
				.set({
					status: upstream.code === 'auth_required' ? 'pending_auth' : 'error',
					statusMessage: upstream.message
				})
				.where(eq(connector.id, conn.id));
		}
		await record({
			type: 'connector.synced',
			outcome: 'failure',
			workspaceId: conn.workspaceId,
			userId: actorUserId,
			connectorId: conn.id,
			metadata: { reason, error: upstream.code }
		});
		error(
			424,
			required
				? `${conn.name} needs you to sign in${required === 'token' ? ' with a token or API key' : ''} before its tools can load.`
				: upstream.code === 'auth_required'
					? `${conn.name}: connect your account first.`
					: `${conn.name}: ${upstream.message}`,
			{ code: 'GENERIC' }
		);
	}

	const result = await applyToolList(conn, listed.tools, listed.info, {
		notify: reason !== 'manual'
	});
	await record({
		type: 'connector.synced',
		outcome: 'success',
		workspaceId: conn.workspaceId,
		userId: actorUserId,
		connectorId: conn.id,
		metadata: {
			reason,
			added: result.added,
			updated: result.updated,
			removed: result.removed,
			signatureChanged: result.signatureChanged.length,
			protocolVersion: listed.info.protocolVersion
		}
	});
	if (result.descriptionChanged.length > 0) {
		await record({
			type: 'connector.descriptions_changed',
			outcome: 'success',
			workspaceId: conn.workspaceId,
			userId: actorUserId,
			connectorId: conn.id,
			metadata: { count: result.descriptionChanged.length, unverified: conn.unverified }
		});
	}
	return result;
}
