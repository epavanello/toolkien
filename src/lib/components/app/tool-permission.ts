import type { PermissionLevel } from '#lib/server/db/schema/workspaces.ts';
import type { ToolPermission } from '#lib/server/permissions/types.ts';
import type { FilterOption } from './filter-bar.svelte';

/** How each level reads in the UI (badges, selects, filters, group defaults) */
export const LEVEL_LABELS: Record<PermissionLevel, string> = {
	allow: 'Always allow',
	ask: 'Ask',
	block: 'Blocked'
};

/** Options of the "Level" filter: the effective level, or "to confirm" */
export const LEVEL_FILTER_OPTIONS: FilterOption[] = [
	{ value: 'allow', label: LEVEL_LABELS.allow },
	{ value: 'ask', label: LEVEL_LABELS.ask },
	{ value: 'block', label: LEVEL_LABELS.block },
	{ value: 'confirm', label: 'To confirm' }
];

/** Whether a tool matches a `LEVEL_FILTER_OPTIONS` value (`''` matches everything) */
export const matchesLevel = (tool: ToolPermission, value: string): boolean =>
	!value ||
	(value === 'confirm' ? tool.effective.needsConfirmation : tool.effective.level === value);

/**
 * Default level shared by every tool of a group ("Default: Ask"), "Proposed" when the
 * connector is unverified (the default waits for a person's confirmation); `null` when the
 * tools of the group do not share one.
 */
export function groupDefault(tools: ToolPermission[]): string | null {
	const levels = new Set(tools.map((tool) => tool.defaultLevel));
	if (tools.length === 0 || levels.size !== 1) return null;
	const label = LEVEL_LABELS[tools[0].defaultLevel];
	return tools.every((tool) => tool.unverified) ? `Proposed: ${label}` : `Default: ${label}`;
}

/** "6 tools · 2 to confirm · 1 blocked": what a collapsed connector holds */
export function permissionSummary(tools: ToolPermission[]): string {
	const confirm = tools.filter((tool) => tool.effective.needsConfirmation).length;
	const blocked = tools.filter((tool) => tool.effective.level === 'block').length;
	return [
		`${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`,
		confirm > 0 && `${confirm} to confirm`,
		blocked > 0 && `${blocked} blocked`
	]
		.filter(Boolean)
		.join(' · ');
}

/** Tools whose path or connector name contains `search` and whose level matches `level` */
export function filterPermissions(
	tools: ToolPermission[],
	search: string,
	level: string
): ToolPermission[] {
	const query = search.trim().toLowerCase();
	return tools.filter(
		(tool) =>
			matchesLevel(tool, level) &&
			(!query ||
				tool.path.toLowerCase().includes(query) ||
				tool.connectorName.toLowerCase().includes(query))
	);
}
