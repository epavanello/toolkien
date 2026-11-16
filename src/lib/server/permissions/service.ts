import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { AuditService } from '#lib/server/audit/types.ts';
import type { Db, Tx } from '#lib/server/db/index.ts';
import {
	connector,
	member,
	permissionLevel,
	tool,
	toolVersion,
	workspacePolicy
} from '#lib/server/db/schema/index.ts';
import type { ConnectorSource, ToolAnnotations } from '#lib/server/db/schema/index.ts';
import {
	defaultLevel,
	floorFor,
	isReadOnly,
	resolveEffectiveLevel,
	satisfiesFloor
} from './resolve.ts';
import type {
	EffectiveLevel,
	PermissionLevel,
	PermissionRowInput,
	PermissionsService,
	ToolPermission
} from './types.ts';

export type PermissionsDeps = {
	db: Db;
	audit: Pick<AuditService, 'record'>;
};

type ToolFacts = {
	toolId: string;
	path: string;
	connectorId: string;
	connectorName: string;
	source: ConnectorSource;
	unverified: boolean;
	annotations: ToolAnnotations | null;
	signatureHash: string;
};

/** Unknown, removed, foreign or invisible tools resolve to this: never callable */
const DENIED: EffectiveLevel = { level: 'block', needsConfirmation: false, source: 'policy' };
const CHUNK = 400;

/** "a.b, c.d and 3 more": the tools an error is about */
const NAMED_TOOLS = 5;
const describeTools = (paths: string[]) => {
	const named = paths.slice(0, NAMED_TOOLS).join(', ');
	const rest = paths.length - NAMED_TOOLS;
	return rest > 0 ? `${named} and ${rest} more` : named;
};

const chunks = <T>(items: T[]) =>
	Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) =>
		items.slice(i * CHUNK, (i + 1) * CHUNK)
	);

export function createPermissionsService(deps: PermissionsDeps): PermissionsService {
	const { db } = deps;

	/** Current definition of tools the user can see in the workspace (`null` ids = all) */
	async function loadTools(
		workspaceId: string,
		userId: string,
		toolIds: string[] | null,
		q: Db | Tx = db
	): Promise<ToolFacts[]> {
		const query = (ids: string[] | null) =>
			q
				.select({
					toolId: tool.id,
					path: tool.path,
					connectorId: connector.id,
					connectorName: connector.name,
					source: connector.source,
					unverified: connector.unverified,
					annotations: toolVersion.annotations,
					signatureHash: toolVersion.signatureHash
				})
				.from(tool)
				.innerJoin(connector, eq(connector.id, tool.connectorId))
				.innerJoin(
					toolVersion,
					and(eq(toolVersion.toolId, tool.id), eq(toolVersion.version, tool.currentVersion))
				)
				.where(
					and(
						eq(tool.workspaceId, workspaceId),
						eq(connector.workspaceId, workspaceId),
						isNull(tool.removedAt),
						// Personal connectors added "only for me" are invisible to everyone else
						or(isNull(connector.ownerUserId), eq(connector.ownerUserId, userId)),
						ids ? inArray(tool.id, ids) : undefined
					)
				);
		if (toolIds === null) return query(null);
		const rows: ToolFacts[] = [];
		for (const ids of chunks([...new Set(toolIds)])) rows.push(...(await query(ids)));
		return rows;
	}

	async function loadRows(workspaceId: string, userId: string, toolIds: string[], q: Db | Tx = db) {
		const workspaceRows = new Map<string, NonNullable<PermissionRowInput>>();
		const userRows = new Map<string, NonNullable<PermissionRowInput>>();
		for (const ids of chunks(toolIds)) {
			const rows = await q
				.select({
					toolId: permissionLevel.toolId,
					userId: permissionLevel.userId,
					level: permissionLevel.level,
					confirmedSignatureHash: permissionLevel.confirmedSignatureHash
				})
				.from(permissionLevel)
				.where(
					and(
						eq(permissionLevel.workspaceId, workspaceId),
						inArray(permissionLevel.toolId, ids),
						or(isNull(permissionLevel.userId), eq(permissionLevel.userId, userId))
					)
				);
			for (const row of rows) {
				const value = { level: row.level, confirmedSignatureHash: row.confirmedSignatureHash };
				(row.userId === null ? workspaceRows : userRows).set(row.toolId, value);
			}
		}
		return { workspaceRows, userRows };
	}

	async function policyFloor(
		workspaceId: string,
		q: Db | Tx = db
	): Promise<PermissionLevel | null> {
		const [row] = await q
			.select({ floor: workspacePolicy.permissionFloor })
			.from(workspacePolicy)
			.where(eq(workspacePolicy.workspaceId, workspaceId))
			.limit(1);
		return row?.floor ?? null;
	}

	async function resolveMany(workspaceId: string, userId: string, toolIds: string[] | null) {
		const tools = await loadTools(workspaceId, userId, toolIds);
		const [rows, floor] = await Promise.all([
			loadRows(
				workspaceId,
				userId,
				tools.map((t) => t.toolId)
			),
			policyFloor(workspaceId)
		]);
		return tools.map((facts) => {
			const workspaceRow = rows.workspaceRows.get(facts.toolId) ?? null;
			const userRow = rows.userRows.get(facts.toolId) ?? null;
			const input = {
				source: facts.source,
				unverified: facts.unverified,
				annotations: facts.annotations,
				signatureHash: facts.signatureHash,
				policyFloor: floor,
				workspaceRow,
				userRow
			};
			return { facts, workspaceRow, userRow, floor, effective: resolveEffectiveLevel(input) };
		});
	}

	const getEffectiveLevels: PermissionsService['getEffectiveLevels'] = async (
		workspaceId,
		userId,
		toolIds
	) => {
		const result = new Map<string, EffectiveLevel>(toolIds.map((id) => [id, DENIED]));
		if (toolIds.length === 0) return result;
		for (const { facts, effective } of await resolveMany(workspaceId, userId, toolIds)) {
			result.set(facts.toolId, effective);
		}
		return result;
	};

	const getEffectiveLevel: PermissionsService['getEffectiveLevel'] = async (subject) =>
		(await getEffectiveLevels(subject.workspaceId, subject.userId, [subject.toolId])).get(
			subject.toolId
		) ?? DENIED;

	const visibleToolIds: PermissionsService['visibleToolIds'] = async (
		workspaceId,
		userId,
		toolIds
	) => {
		const levels = await getEffectiveLevels(workspaceId, userId, toolIds);
		return toolIds.filter((id) => levels.get(id)?.level !== 'block');
	};

	const listToolPermissions: PermissionsService['listToolPermissions'] = async (actor) => {
		const resolved = await resolveMany(actor.workspaceId, actor.userId, null);
		return resolved
			.map(({ facts, workspaceRow, userRow, floor, effective }): ToolPermission => {
				const proposed = defaultLevel(facts);
				return {
					toolId: facts.toolId,
					path: facts.path,
					connectorId: facts.connectorId,
					connectorName: facts.connectorName,
					source: facts.source,
					unverified: facts.unverified,
					readOnly: isReadOnly(facts.annotations),
					destructive: facts.annotations?.destructiveHint === true,
					unannotated:
						facts.annotations?.readOnlyHint === undefined &&
						facts.annotations?.destructiveHint === undefined,
					annotations: facts.annotations,
					effective,
					defaultLevel: proposed,
					chosen: (userRow ?? workspaceRow)?.level ?? proposed,
					userLevel: userRow?.level ?? null,
					workspaceLevel: workspaceRow?.level ?? null,
					floor: floorFor(floor, workspaceRow),
					policyFloor: floor
				};
			})
			.sort((a, b) => a.path.localeCompare(b.path));
	};

	const setLevels: PermissionsService['setLevels'] = async (input) => {
		const { workspaceId, actorUserId, level } = input;
		const scope = input.userId === null ? 'workspace' : 'user';
		const toolIds = [...new Set(input.toolIds)];
		if (toolIds.length === 0) return { updated: 0 };
		const single = toolIds.length === 1;

		const [membership] = await db
			.select({ role: member.role })
			.from(member)
			.where(and(eq(member.organizationId, workspaceId), eq(member.userId, actorUserId)))
			.limit(1);
		if (!membership) error(404, 'Workspace not found.', { code: 'NOT_FOUND' });
		const isAdmin = membership.role === 'owner' || membership.role === 'admin';

		if (input.userId === null && !isAdmin) {
			error(403, 'Only admins can set workspace levels.', { code: 'FORBIDDEN' });
		}
		if (input.userId !== null && input.userId !== actorUserId) {
			error(403, 'You can only change your own levels.', { code: 'FORBIDDEN' });
		}

		// Validation and writes share one transaction: every tool takes the level, or none does
		const changes = await db.transaction(async (tx) => {
			const facts = await loadTools(workspaceId, actorUserId, toolIds, tx);
			if (facts.length < toolIds.length) {
				const missing = toolIds.length - facts.length;
				error(
					404,
					single
						? 'Tool not found.'
						: `Nothing was changed: ${missing} of these tools no longer exist. Reload and try again.`,
					{ code: 'NOT_FOUND' }
				);
			}
			const rows = await loadRows(workspaceId, actorUserId, toolIds, tx);
			const floor = await policyFloor(workspaceId, tx);

			const planned = facts.map((fact) => {
				const workspaceRow = rows.workspaceRows.get(fact.toolId) ?? null;
				const own = input.userId === null ? workspaceRow : rows.userRows.get(fact.toolId);
				// 'current' confirms what the scope has now: its row, else (users) the workspace row,
				// else the default, as the "Confirm" button of one row does
				const target =
					level === 'current'
						? ((own ?? (input.userId === null ? null : workspaceRow))?.level ?? defaultLevel(fact))
						: level;
				const minimum = input.userId === null ? (floor ?? 'allow') : floorFor(floor, workspaceRow);
				return { tool: fact, target, minimum, previous: own?.level ?? null };
			});

			const refused = planned.filter((p) => !satisfiesFloor(p.target, p.minimum));
			if (refused.length > 0) {
				error(
					403,
					single
						? `The workspace policy requires at least "${refused[0].minimum}" for this tool.`
						: `Nothing was changed: the workspace policy requires a stricter level for ${describeTools(refused.map((p) => p.tool.path).sort())}.`,
					{ code: 'POLICY_DENIED' }
				);
			}

			for (const batch of chunks(planned)) {
				const values = batch.map((p) => ({
					workspaceId,
					userId: input.userId,
					toolId: p.tool.toolId,
					level: p.target,
					confirmedSignatureHash: p.tool.signatureHash,
					setBy: actorUserId
				}));
				// Each row keeps its own level and signature: take them from the conflicting insert
				const set = {
					level: sql`excluded.level`,
					confirmedSignatureHash: sql`excluded.confirmed_signature_hash`,
					setBy: sql`excluded.set_by`
				};
				await tx
					.insert(permissionLevel)
					.values(values)
					.onConflictDoUpdate(
						input.userId === null
							? {
									target: [permissionLevel.workspaceId, permissionLevel.toolId],
									targetWhere: isNull(permissionLevel.userId),
									set
								}
							: {
									target: [
										permissionLevel.workspaceId,
										permissionLevel.toolId,
										permissionLevel.userId
									],
									targetWhere: isNotNull(permissionLevel.userId),
									set
								}
					);
			}
			return planned;
		});

		// One event per tool, like single changes; after the commit, so a rollback leaves none
		for (const { tool, target, previous } of changes) {
			await deps.audit.record({
				type: 'permission.changed',
				outcome: 'success',
				workspaceId,
				userId: actorUserId,
				connectorId: tool.connectorId,
				toolPath: tool.path,
				metadata: {
					toolId: tool.toolId,
					scope,
					level: target,
					previous,
					...(single ? {} : { bulk: changes.length })
				}
			});
		}
		return { updated: changes.length };
	};

	const setLevel: PermissionsService['setLevel'] = async ({ toolId, ...input }) => {
		await setLevels({ ...input, toolIds: [toolId] });
	};

	return {
		defaultLevel,
		getEffectiveLevel,
		getEffectiveLevels,
		setLevel,
		setLevels,
		visibleToolIds,
		listToolPermissions
	};
}
