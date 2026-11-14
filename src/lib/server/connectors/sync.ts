import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db, type Tx } from '#lib/server/db/index.ts';
import { connector, tool, toolSearchText, toolVersion } from '#lib/server/db/schema/index.ts';
import { signatureHash, toCamelCase, uniqueName } from '#lib/server/typegen/index.ts';
import type { ConnectorRow } from './access.ts';
import { getDirectoryEntry } from './directory.ts';
import { searchText } from './search.ts';
import { upstreamCredential } from './session.ts';
import type { SyncReason, SyncResult, ToolAnnotations } from './types.ts';
import { listTools, UpstreamError, type SessionInfo, type UpstreamTool } from './upstream.ts';

/**
 * `tools/list` → versioned definitions. Paths stay stable across syncs (a tool keeps its path
 * while its upstream name exists); new names get the first free camelCase name in the
 * connector. A version is saved whenever schema, annotations, title or description change;
 * permissions compare their confirmed hash with the current version's, so a changed signature
 * is "to confirm" without touching permission rows. The `tool_search_text` rows of the
 * connector are rebuilt in the same transaction.
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

/** Applies a `tools/list` result; pure database work, no network */
export async function applyToolList(
	conn: ConnectorRow,
	upstreamTools: UpstreamTool[],
	info: SessionInfo
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

		await tx
			.update(connector)
			.set({
				status: 'active',
				statusMessage: null,
				lastSyncedAt: now,
				protocolVersion: info.protocolVersion,
				serverInfo: info.serverInfo,
				toolsListChanged: info.toolsListChanged
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
		// Personal credentials fail per user: only shared failures change the connector status
		if (credentialUserId === null || conn.authType === 'none') {
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
			upstream.code === 'auth_required'
				? `${conn.name}: connect your account first.`
				: `${conn.name}: ${upstream.message}`,
			{
				code: 'GENERIC'
			}
		);
	}

	const result = await applyToolList(conn, listed.tools, listed.info);
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
