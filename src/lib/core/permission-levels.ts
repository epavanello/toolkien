import type { PermissionLevel } from '#lib/server/db/schema/workspaces.ts';

/**
 * Ordering rules of permission levels, isomorphic: the server resolver and setters
 * (`server/permissions`) and the UI (level selects, bulk plans) use these same functions, so a
 * screen never disagrees with what the server accepts.
 */

/** Levels from the loosest to the strictest (same order as `PERMISSION_LEVELS`) */
export const LEVELS = ['allow', 'ask', 'block'] as const satisfies readonly PermissionLevel[];

/** block > ask > allow */
export const LEVEL_RANK: Record<PermissionLevel, number> = { allow: 0, ask: 1, block: 2 };

/** The most restrictive of `levels` (`allow` when none is set) */
export const mostRestrictive = (
	...levels: (PermissionLevel | null | undefined)[]
): PermissionLevel =>
	levels.reduce<PermissionLevel>(
		(worst, level) => (level && LEVEL_RANK[level] > LEVEL_RANK[worst] ? level : worst),
		'allow'
	);

/** `level` is at least as restrictive as `minimum` */
export const satisfiesFloor = (level: PermissionLevel, minimum: PermissionLevel) =>
	LEVEL_RANK[level] >= LEVEL_RANK[minimum];
