import type {
	ConnectorSource,
	PermissionLevel,
	ToolAnnotations
} from '#lib/server/db/schema/index.ts';
import type { WorkspaceActor } from '#lib/server/workspaces/types.ts';

export type { PermissionLevel };

/**
 * Permissions contract (owner: execution).
 *
 * Levels: `allow` (always allowed), `ask` (ask for confirmation), `block` (blocked).
 * Defaults by tool origin:
 * - trusted directory entry (publisher `official`, check `tested`/`documented`):
 *   `readOnlyHint: true` → `allow`; write or `destructiveHint` → `ask`
 * - (changed) community entries, `needs-review` entries and free URLs (every connector stored as
 *   `unverified`) → the same rule is *proposed*; the user confirms it on first configuration,
 *   until then the tool is treated as `ask` (reads) / `ask` (writes)
 * - no annotations → treated as a write → `ask`
 *
 * Resolution: the effective level is the most restrictive of the default, the workspace policy
 * floor, the workspace (admin) row and the user row. A member can only tighten.
 * If the level was confirmed against a different `signatureHash` than the tool's current one,
 * the tool is "to confirm" and treated as at least `ask`.
 * `block`ed tools never appear in discovery; the bridge checks the level on EVERY call.
 */

/** block > ask > allow; the rules live in `#lib/core/permission-levels.ts` (shared with the UI) */
export { LEVEL_RANK, mostRestrictive } from '#lib/core/permission-levels.ts';

export type PermissionSubject = { workspaceId: string; userId: string; toolId: string };

export type DefaultLevelInput = {
	source: ConnectorSource;
	annotations: ToolAnnotations | null;
};

export type EffectiveLevel = {
	level: PermissionLevel;
	/** Signature changed since confirmation, or the default of an unverified connector never confirmed */
	needsConfirmation: boolean;
	/** Which layer decided the level (for the UI and the audit `approvedBy`) */
	source: 'default' | 'policy' | 'workspace' | 'user';
};

/** One `permission_level` row as the resolver needs it (`null` = no row) */
export type PermissionRowInput = {
	level: PermissionLevel;
	confirmedSignatureHash: string | null;
} | null;

/** Everything `resolveEffectiveLevel` needs about one tool for one user */
export type ResolveLevelInput = DefaultLevelInput & {
	/**
	 * (additive) `connector.unverified`: free URL, community or needs-review directory entry.
	 * Only `source = 'directory'` with `unverified: false` counts as trusted; a missing value is
	 * treated as unverified (fail closed).
	 */
	unverified?: boolean;
	/** Signature hash of the tool's current version */
	signatureHash: string;
	/** `workspace_policy.permission_floor` */
	policyFloor: PermissionLevel | null;
	/** Admin row (`user_id IS NULL`): per-tool floor and workspace default */
	workspaceRow: PermissionRowInput;
	/** The user's own row */
	userRow: PermissionRowInput;
};

/** One row of the permissions page (metadata only) */
export type ToolPermission = {
	toolId: string;
	path: string;
	connectorId: string;
	connectorName: string;
	source: ConnectorSource;
	unverified: boolean;
	readOnly: boolean;
	destructive: boolean;
	/** The upstream sent no read/destructive hint (treated as a write) */
	unannotated: boolean;
	/** (additive) Annotations of the current version, for grouping by operation type (`toolGroup`) */
	annotations: ToolAnnotations | null;
	effective: EffectiveLevel;
	/** Level from the default table (proposed level for free URLs) */
	defaultLevel: PermissionLevel;
	/** Level the user would get without floors and confirmation (row or default) */
	chosen: PermissionLevel;
	userLevel: PermissionLevel | null;
	workspaceLevel: PermissionLevel | null;
	/** Most restrictive of policy floor and workspace row: the user cannot go below it */
	floor: PermissionLevel;
	/** (additive) `workspace_policy.permission_floor`: the workspace minimum cannot go below it */
	policyFloor: PermissionLevel | null;
};

/**
 * Level of a bulk change: one level for every tool, or `current` to confirm the level each tool
 * has now in that scope (its row, else for a user the workspace row, else the default), as the
 * "Confirm" of a single row does.
 */
export type BulkLevel = PermissionLevel | 'current';

export interface PermissionsService {
	/** Pure: default level from the origin table above */
	defaultLevel(input: DefaultLevelInput): PermissionLevel;
	getEffectiveLevel(subject: PermissionSubject): Promise<EffectiveLevel>;
	/** Effective levels for many tools at once (discovery filtering) */
	getEffectiveLevels(
		workspaceId: string,
		userId: string,
		toolIds: string[]
	): Promise<Map<string, EffectiveLevel>>;
	/**
	 * Sets a level. `userId: null` = workspace floor (admin only). Rejects a member level less
	 * restrictive than the floor. Stores the current signature hash as confirmed and records a
	 * `permission.changed` audit event.
	 */
	setLevel(input: {
		workspaceId: string;
		actorUserId: string;
		userId: string | null;
		toolId: string;
		level: PermissionLevel;
	}): Promise<void>;
	/**
	 * (additive) `setLevel` for many tools of one scope, all or nothing: the same authorization,
	 * visibility and floor checks run for every tool inside one transaction; if any tool is
	 * missing (removed, foreign, private connector of someone else) or its minimum is stricter
	 * than its target level, nothing is written and the error names the refused tools. Duplicate
	 * ids count once. One `permission.changed` event per tool (metadata `bulk` = count) after the
	 * commit. `setLevel` is this with one tool.
	 */
	setLevels(input: {
		workspaceId: string;
		actorUserId: string;
		userId: string | null;
		toolIds: string[];
		level: BulkLevel;
	}): Promise<{ updated: number }>;
	/** Tools of `toolIds` that are not blocked for the user (discovery and declarations) */
	visibleToolIds(workspaceId: string, userId: string, toolIds: string[]): Promise<string[]>;
	/** Every non-removed tool the actor can see, with its levels (permissions page) */
	listToolPermissions(actor: WorkspaceActor): Promise<ToolPermission[]>;
}
