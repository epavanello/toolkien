import type {
	ConnectorSource,
	PermissionLevel,
	ToolAnnotations
} from '#lib/server/db/schema/index.ts';

export type { PermissionLevel };

/**
 * Permissions contract (owner: execution).
 *
 * Levels: `allow` (always allowed), `ask` (ask for confirmation), `block` (blocked).
 * Defaults by tool origin:
 * - curated directory + `readOnlyHint: true` → `allow`
 * - curated directory + write or `destructiveHint` → `ask`
 * - free URL → the same rule is *proposed*; the user confirms it on first configuration, until
 *   then the tool is treated as `ask` (reads) / `ask` (writes)
 * - no annotations → treated as a write → `ask`
 *
 * Resolution: the effective level is the most restrictive of the default, the workspace policy
 * floor, the workspace (admin) row and the user row. A member can only tighten.
 * If the level was confirmed against a different `signatureHash` than the tool's current one,
 * the tool is "to confirm" and treated as at least `ask`.
 * `block`ed tools never appear in discovery; the bridge checks the level on EVERY call.
 */

/** block > ask > allow */
export const LEVEL_RANK: Record<PermissionLevel, number> = { allow: 0, ask: 1, block: 2 };

export const mostRestrictive = (
	...levels: (PermissionLevel | null | undefined)[]
): PermissionLevel =>
	levels.reduce<PermissionLevel>(
		(worst, level) => (level && LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst),
		'allow'
	);

export type PermissionSubject = { workspaceId: string; userId: string; toolId: string };

export type DefaultLevelInput = {
	source: ConnectorSource;
	annotations: ToolAnnotations | null;
};

export type EffectiveLevel = {
	level: PermissionLevel;
	/** Signature changed since confirmation, or free-URL default never confirmed */
	needsConfirmation: boolean;
	/** Which layer decided the level (for the UI and the audit `approvedBy`) */
	source: 'default' | 'policy' | 'workspace' | 'user';
};

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
}
