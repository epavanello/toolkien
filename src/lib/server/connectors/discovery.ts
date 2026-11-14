import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { connector, connectorCredential, tool, toolVersion } from '#lib/server/db/schema/index.ts';
import { visibleToolIds } from '#lib/server/permissions/index.ts';
import { moduleDeclaration, type ToolTypeInput } from '#lib/server/typegen/index.ts';
import type { WorkspaceActor } from '#lib/server/workspaces/types.ts';
import { visibleTo } from './access.ts';
import type { ResolvedTool, ToolAnnotations, ToolDescription, ToolSearchHit } from './types.ts';

/**
 * Discovery: what an actor can find and call. A tool is callable when its connector is
 * visible to the actor, not suspended or disabled, has a usable credential for the actor
 * (shared → the shared one, personal → the actor's own; `none` needs nothing), the tool is
 * still listed upstream, and permissions do not block it.
 */

const SUMMARY_LENGTH = 160;

export type ToolRecord = {
	id: string;
	path: string;
	upstreamName: string;
	connectorId: string;
	connectorName: string;
	/** Instance label (`DevMotion`) when the server is added once per account/project */
	label: string | null;
	namespace: string;
	source: 'directory' | 'url';
	unverified: boolean;
	title: string | null;
	description: string | null;
	inputSchema: Record<string, unknown>;
	outputSchema: Record<string, unknown> | null;
	annotations: ToolAnnotations | null;
	signatureHash: string;
	version: number;
};

const columns = {
	id: tool.id,
	path: tool.path,
	upstreamName: tool.upstreamName,
	connectorId: connector.id,
	connectorName: connector.name,
	label: connector.label,
	namespace: connector.namespace,
	source: connector.source,
	unverified: connector.unverified,
	title: toolVersion.title,
	description: toolVersion.description,
	inputSchema: toolVersion.inputSchema,
	outputSchema: toolVersion.outputSchema,
	annotations: toolVersion.annotations,
	signatureHash: toolVersion.signatureHash,
	version: toolVersion.version
};

/** Tools of connectors the actor can use right now (before permission filtering) */
function usableTools(actor: WorkspaceActor, extra?: SQL) {
	const credentialExists = sql`exists (select 1 from ${connectorCredential} where ${connectorCredential.connectorId} = ${connector.id} and (
		(${connector.scope} = 'shared' and ${connectorCredential.userId} is null) or
		(${connector.scope} = 'personal' and ${connectorCredential.userId} = ${actor.userId})))`;
	return db
		.select(columns)
		.from(tool)
		.innerJoin(connector, eq(connector.id, tool.connectorId))
		.innerJoin(
			toolVersion,
			and(eq(toolVersion.toolId, tool.id), eq(toolVersion.version, tool.currentVersion))
		)
		.where(
			and(
				visibleTo(actor),
				isNull(tool.removedAt),
				isNull(connector.suspendedAt),
				sql`${connector.status} <> 'disabled'`,
				or(eq(connector.authType, 'none'), credentialExists),
				extra
			)
		);
}

/** Drops tools that permissions block for the actor */
async function withoutBlocked<T extends { id: string }>(
	actor: WorkspaceActor,
	rows: T[]
): Promise<T[]> {
	if (rows.length === 0) return rows;
	const allowed = new Set(
		await visibleToolIds(
			actor.workspaceId,
			actor.userId,
			rows.map((r) => r.id)
		)
	);
	return rows.filter((row) => allowed.has(row.id));
}

/**
 * One line for search results. Labelled instances name the account so agents can tell them
 * apart: `PostHog (DevMotion): Run a HogQL query.`
 */
export const summaryOf = (
	record: Pick<ToolRecord, 'title' | 'description' | 'unverified'> &
		Partial<Pick<ToolRecord, 'connectorName' | 'label'>>
) => {
	const text =
		(record.description ?? record.title ?? '').trim().split('\n')[0].trim() || 'No description.';
	const line = text.length > SUMMARY_LENGTH ? `${text.slice(0, SUMMARY_LENGTH - 1)}…` : text;
	const instance = record.label ? `${record.connectorName} (${record.label}): ` : '';
	return `${record.unverified ? '[unverified] ' : ''}${instance}${line}`;
};

export const toTypeInput = (record: ToolRecord): ToolTypeInput => ({
	path: record.path,
	namespace: record.namespace,
	functionName: record.path.slice(record.namespace.length + 1),
	title: record.title,
	description: record.description,
	inputSchema: record.inputSchema,
	outputSchema: record.outputSchema,
	annotations: record.annotations,
	unverified: record.unverified,
	connectorName: record.connectorName,
	instanceLabel: record.label
});

/** FTS5 query: every word as a prefix term, OR-ed, ranked by bm25 */
export function ftsQuery(text: string): string | null {
	const words = text
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.toLowerCase()
		.match(/[\p{L}\p{N}]+/gu);
	if (!words || words.length === 0) return null;
	return [...new Set(words)]
		.slice(0, 12)
		.map((w) => `"${w}"*`)
		.join(' OR ');
}

export async function searchTools(
	actor: WorkspaceActor,
	query: string,
	limit = 20
): Promise<ToolSearchHit[]> {
	const cap = Math.min(Math.max(limit, 1), 100);
	const match = ftsQuery(query);
	let rows: ToolRecord[];
	if (!match) {
		rows = (await usableTools(actor).orderBy(tool.path)) as ToolRecord[];
	} else {
		const ranked = await db.all<{ tool_id: string }>(
			sql`SELECT tool_id FROM tool_search WHERE tool_search MATCH ${match} AND workspace_id = ${actor.workspaceId} ORDER BY bm25(tool_search, 0, 0, 10.0, 5.0, 1.0) LIMIT 500`
		);
		if (ranked.length === 0) return [];
		const order = new Map(ranked.map((r, i) => [r.tool_id, i]));
		rows = ((await usableTools(actor, inArray(tool.id, [...order.keys()]))) as ToolRecord[]).sort(
			(a, b) => order.get(a.id)! - order.get(b.id)!
		);
	}
	const allowed = await withoutBlocked(actor, rows);
	return allowed.slice(0, cap).map((row) => ({
		path: row.path,
		summary: summaryOf(row),
		connectorName: row.connectorName,
		unverified: row.unverified,
		namespace: row.namespace,
		accountHint: row.label
	}));
}

async function recordsByPath(actor: WorkspaceActor, paths: string[]) {
	if (paths.length === 0) return [];
	const rows = (await usableTools(
		actor,
		inArray(tool.path, [...new Set(paths)].slice(0, 200))
	)) as ToolRecord[];
	return withoutBlocked(actor, rows);
}

export async function describeTools(
	actor: WorkspaceActor,
	paths: string[]
): Promise<ToolDescription[]> {
	const rows = await recordsByPath(actor, paths);
	const byPath = new Map(rows.map((row) => [row.path, row]));
	const ordered = [...new Set(paths)].flatMap((path) => byPath.get(path) ?? []);
	// One declaration per namespace (two `declare const ns` blocks would not type-check)
	const byNamespace = new Map<string, ToolRecord[]>();
	for (const row of ordered) {
		byNamespace.set(row.namespace, [...(byNamespace.get(row.namespace) ?? []), row]);
	}
	const result: ToolDescription[] = [];
	for (const row of ordered) {
		const group = byNamespace.get(row.namespace)!;
		result.push({
			path: row.path,
			declaration: group[0] === row ? await moduleDeclaration(group.map(toTypeInput)) : '',
			connectorName: row.connectorName,
			namespace: row.namespace,
			accountHint: row.label
		});
	}
	return result;
}

export async function declarationsFor(actor: WorkspaceActor, toolIds: string[]): Promise<string> {
	const rows = (await usableTools(
		actor,
		toolIds.length > 0 ? inArray(tool.id, toolIds) : undefined
	)) as ToolRecord[];
	return moduleDeclaration((await withoutBlocked(actor, rows)).map(toTypeInput));
}

/**
 * The tool behind a path for the bridge. Visibility and suspension only: permission levels
 * and credentials are checked by the bridge / at call time.
 */
export async function resolveTool(
	actor: WorkspaceActor,
	path: string
): Promise<ResolvedTool | null> {
	const [row] = (await db
		.select({ ...columns, workspaceId: connector.workspaceId })
		.from(tool)
		.innerJoin(connector, eq(connector.id, tool.connectorId))
		.innerJoin(
			toolVersion,
			and(eq(toolVersion.toolId, tool.id), eq(toolVersion.version, tool.currentVersion))
		)
		.where(
			and(
				visibleTo(actor),
				eq(tool.path, path),
				isNull(tool.removedAt),
				isNull(connector.suspendedAt)
			)
		)
		.limit(1)) as (ToolRecord & { workspaceId: string })[];
	if (!row) return null;
	return {
		toolId: row.id,
		path: row.path,
		connectorId: row.connectorId,
		workspaceId: row.workspaceId,
		upstreamName: row.upstreamName,
		signatureHash: row.signatureHash,
		annotations: row.annotations,
		source: row.source,
		unverified: row.unverified,
		inputSchema: row.inputSchema,
		outputSchema: row.outputSchema
	};
}
