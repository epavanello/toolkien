import { and, asc, eq, inArray, isNotNull, isNull, lt, notInArray } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { connector } from '#lib/server/db/schema/index.ts';
import type { McpToolName } from '#lib/server/mcp/types.ts';
import type { ConnectorRow } from './access.ts';
import { listCredentials } from './credentials.ts';
import { syncConnector } from './sync.ts';

/**
 * Keeping catalogs fresh without anyone pressing Refresh (single instance, in memory like the
 * `list_changed` watchers):
 *
 * - **Daily resync** (job `connectors.resync`, hourly): connectors whose upstream does not
 *   announce `tools/list_changed`, last synced more than a day ago, are synced again through
 *   the same path as Refresh (reason `scheduled`, no actor). A few per run, oldest first, one
 *   at a time, so a deploy or a day of new connectors never hits every upstream in the same
 *   minute. A failed attempt is not retried by the job for a day (the failure lands in the
 *   connector status as for any sync). Never-synced, suspended, disabled and `pending_auth`
 *   connectors are skipped: they wait for someone to connect them.
 * - **Rejected calls**: an upstream answer of unknown tool / invalid arguments resyncs the
 *   connector at most once every 10 minutes, so an agent retrying bad arguments in a loop
 *   does not turn into a `tools/list` loop.
 */

const HOUR = 60 * 60 * 1000;
export const RESYNC_AFTER_MS = 24 * HOUR;
/** Connectors synced per hourly run (one at a time) */
export const RESYNC_BATCH = 25;
export const REJECTION_RESYNC_MS = 10 * 60 * 1000;

/** connector id → time of the last scheduled attempt, successful or not */
const attempts = new Map<string, number>();
/** connector id → time of the last resync caused by a rejected call */
const rejections = new Map<string, number>();

const recent = (map: Map<string, number>, windowMs: number, now: number) => {
	for (const [id, at] of map) if (now - at >= windowMs) map.delete(id);
	return [...map.keys()];
};

/** Connectors the next scheduled run syncs, oldest first */
export async function dueForResync(
	now = Date.now(),
	limit = RESYNC_BATCH
): Promise<ConnectorRow[]> {
	const skip = recent(attempts, RESYNC_AFTER_MS, now);
	return db
		.select()
		.from(connector)
		.where(
			and(
				eq(connector.toolsListChanged, false),
				isNull(connector.suspendedAt),
				inArray(connector.status, ['active', 'error']),
				isNotNull(connector.lastSyncedAt),
				lt(connector.lastSyncedAt, new Date(now - RESYNC_AFTER_MS)),
				skip.length > 0 ? notInArray(connector.id, skip) : undefined
			)
		)
		.orderBy(asc(connector.lastSyncedAt))
		.limit(limit);
}

/**
 * Whose credential a sync with nobody present uses: the shared one (`null`) for shared and
 * open connectors; for per-member connectors the owner's, else the most recently saved one of
 * any member (the catalog is one per connector, whoever loads it). `undefined`: none stored.
 */
export async function backgroundCredentialUser(
	row: ConnectorRow
): Promise<string | null | undefined> {
	if (row.authType === 'none') return null;
	const credentials = await listCredentials(row.id);
	if (row.scope === 'shared') return credentials.some((c) => c.userId === null) ? null : undefined;
	const personal = credentials
		.filter((c) => c.userId !== null)
		.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
	return (personal.find((c) => c.userId === row.ownerUserId) ?? personal[0])?.userId ?? undefined;
}

/** One scheduled run: syncs the due connectors one after the other; returns how many synced */
export async function resyncStaleConnectors(now = Date.now()): Promise<number> {
	let synced = 0;
	for (const row of await dueForResync(now)) {
		attempts.set(row.id, now);
		const owner = await backgroundCredentialUser(row);
		if (owner === undefined) continue;
		try {
			await syncConnector(row, owner, 'scheduled', null);
			synced++;
		} catch {
			// The connector status and the audit event say what failed
		}
	}
	return synced;
}

/**
 * Whether a rejected call may resync `connectorId` now (and records it): at most once per
 * connector every `REJECTION_RESYNC_MS`
 */
export function claimRejectionResync(connectorId: string, now = Date.now()): boolean {
	const last = rejections.get(connectorId);
	if (last !== undefined && now - last < REJECTION_RESYNC_MS) return false;
	recent(rejections, REJECTION_RESYNC_MS, now);
	rejections.set(connectorId, now);
	return true;
}

/** Test-only: forget scheduled attempts and rejection resyncs */
export function resetResyncState() {
	attempts.clear();
	rejections.clear();
}

/** Type-checked against the MCP tool list, so a rename cannot leave the hint stale */
const DESCRIBE_TOOL: McpToolName = 'tools_describe';

/**
 * What the agent reads after the server rejected a call (appended to the upstream message):
 * whether the definition changed, then to describe the tool again and retry with the current
 * signature (`declaration`), or that the tool is gone.
 */
export function rejectionHint(input: {
	path: string;
	/** The resync ran for this call; `false` = a recent one already did */
	refreshed: boolean;
	/** The signature differs from the one the script was checked against */
	changed: boolean;
	/** Current `.d.ts`; `null` when the tool no longer exists */
	declaration: string | null;
}): string {
	const { path, declaration } = input;
	if (declaration === null)
		return `Toolkien refreshed the tool catalog: ${path} no longer exists on the server. Search the tools again.`;
	const what = input.changed
		? 'The tool definition changed upstream and Toolkien refreshed the catalog.'
		: input.refreshed
			? 'Toolkien refreshed the catalog: this tool did not change, so check the arguments against its signature.'
			: 'Toolkien refreshed the catalog in the last few minutes: this tool did not change since, so check the arguments against its signature.';
	return `${what} Describe ${path} again (${DESCRIBE_TOOL}) and retry with the current signature:\n${declaration}`;
}
