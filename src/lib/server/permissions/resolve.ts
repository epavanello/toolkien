import type { ConnectorSource, ToolAnnotations } from '#lib/server/db/schema/index.ts';
import {
	LEVEL_RANK,
	mostRestrictive,
	type EffectiveLevel,
	type PermissionLevel,
	type PermissionRowInput,
	type ResolveLevelInput
} from './types.ts';

/**
 * Pure permission rules (no I/O). Security-critical: every branch is covered by
 * `resolve.spec.ts`. When in doubt a rule resolves to the more restrictive level.
 */

/** Whether the upstream declared the tool read-only (and not destructive at the same time) */
export const isReadOnly = (annotations: ToolAnnotations | null | undefined): boolean =>
	annotations?.readOnlyHint === true && annotations.destructiveHint !== true;

/**
 * Default level from the spec table. Free-URL tools get the same *proposed* level; the caller
 * marks them "to confirm" until the user confirms (see `resolveEffectiveLevel`).
 * Missing annotations mean "treated as a write" → `ask`.
 */
export function defaultLevel(input: {
	source: ConnectorSource;
	annotations: ToolAnnotations | null;
}): PermissionLevel {
	return isReadOnly(input.annotations) ? 'allow' : 'ask';
}

/** The minimum a member's own level must respect: workspace policy floor + admin row */
export const floorFor = (
	policyFloor: PermissionLevel | null,
	workspaceRow: PermissionRowInput
): PermissionLevel => mostRestrictive(policyFloor, workspaceRow?.level);

/** `level` is at least as restrictive as `minimum` */
export const satisfiesFloor = (level: PermissionLevel, minimum: PermissionLevel) =>
	LEVEL_RANK[level] >= LEVEL_RANK[minimum];

/**
 * Effective level of one tool for one user.
 *
 * - The *chosen* level is the user's row, else the workspace (admin) row, else the default.
 * - The *floor* is the most restrictive of the policy floor and the workspace row; the result is
 *   never looser than it, whatever the user chose.
 * - "To confirm": the row that provided the chosen level was confirmed against another signature,
 *   or there is no row and the tool comes from a free URL. Such a tool is at least `ask`.
 */
export function resolveEffectiveLevel(input: ResolveLevelInput): EffectiveLevel {
	const { userRow, workspaceRow, policyFloor } = input;
	const baseRow = userRow ?? workspaceRow;
	const chosen = baseRow?.level ?? defaultLevel(input);
	const needsConfirmation = baseRow
		? baseRow.confirmedSignatureHash === null ||
			baseRow.confirmedSignatureHash !== input.signatureHash
		: input.source === 'url';

	const level = mostRestrictive(
		chosen,
		policyFloor,
		workspaceRow?.level,
		needsConfirmation ? 'ask' : null
	);

	let source: EffectiveLevel['source'] = userRow ? 'user' : workspaceRow ? 'workspace' : 'default';
	if (LEVEL_RANK[level] > LEVEL_RANK[chosen]) {
		if (policyFloor === level) source = 'policy';
		else if (workspaceRow?.level === level) source = 'workspace';
	}
	return { level, needsConfirmation, source };
}
