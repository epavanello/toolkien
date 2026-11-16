import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { AuditService } from '#lib/server/audit/types.ts';
import type { Db } from '#lib/server/db/index.ts';
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
		toolIds: string[] | null
	): Promise<ToolFacts[]> {
		const query = (ids: string[] | null) =>
			db
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

	async function loadRows(workspaceId: string, userId: string, toolIds: string[]) {
		const workspaceRows = new Map<string, NonNullable<PermissionRowInput>>();
		const userRows = new Map<string, NonNullable<PermissionRowInput>>();
		for (const ids of chunks(toolIds)) {
			const rows = await db
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

	async function policyFloor(workspaceId: string): Promise<PermissionLevel | null> {
		const [row] = await db
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
					floor: floorFor(floor, workspaceRow)
				};
			})
			.sort((a, b) => a.path.localeCompare(b.path));
	};

	const setLevel: PermissionsService['setLevel'] = async (input) => {
		const { workspaceId, actorUserId, toolId, level } = input;
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

		const [facts] = await loadTools(workspaceId, actorUserId, [toolId]);
		if (!facts) error(404, 'Tool not found.', { code: 'NOT_FOUND' });

		const rows = await loadRows(workspaceId, actorUserId, [toolId]);
		const floor = await policyFloor(workspaceId);
		const workspaceRow = rows.workspaceRows.get(toolId) ?? null;
		const minimum = input.userId === null ? (floor ?? 'allow') : floorFor(floor, workspaceRow);
		if (!satisfiesFloor(level, minimum)) {
			error(403, `The workspace policy requires at least "${minimum}" for this tool.`, {
				code: 'POLICY_DENIED'
			});
		}

		const previous =
			(input.userId === null ? workspaceRow : rows.userRows.get(toolId))?.level ?? null;
		const values = {
			workspaceId,
			userId: input.userId,
			toolId,
			level,
			confirmedSignatureHash: facts.signatureHash,
			setBy: actorUserId
		};
		const set = { level, confirmedSignatureHash: facts.signatureHash, setBy: actorUserId };
		if (input.userId === null) {
			await db
				.insert(permissionLevel)
				.values(values)
				.onConflictDoUpdate({
					target: [permissionLevel.workspaceId, permissionLevel.toolId],
					targetWhere: isNull(permissionLevel.userId),
					set
				});
		} else {
			await db
				.insert(permissionLevel)
				.values(values)
				.onConflictDoUpdate({
					target: [permissionLevel.workspaceId, permissionLevel.toolId, permissionLevel.userId],
					targetWhere: isNotNull(permissionLevel.userId),
					set
				});
		}

		await deps.audit.record({
			type: 'permission.changed',
			outcome: 'success',
			workspaceId,
			userId: actorUserId,
			connectorId: facts.connectorId,
			toolPath: facts.path,
			metadata: {
				toolId,
				scope: input.userId === null ? 'workspace' : 'user',
				level,
				previous
			}
		});
	};

	return {
		defaultLevel,
		getEffectiveLevel,
		getEffectiveLevels,
		setLevel,
		visibleToolIds,
		listToolPermissions
	};
}
