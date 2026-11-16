import { satisfiesFloor } from '#lib/core/permission-levels.ts';
import type { PermissionLevel } from '#lib/server/db/schema/workspaces.ts';
import type { BulkLevel, ToolPermission } from '#lib/server/permissions/types.ts';
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

/** Whose level a bulk change sets: the viewer's own, or the workspace minimum (admins) */
export type BulkScope = 'user' | 'workspace';

/**
 * What one bulk change (`setToolLevels`) will do to a list of tools, computed from
 * `listPermissions` with the server's own rules, so the confirmation says exactly what the
 * all-or-nothing command will accept.
 */
export type BulkPlan = {
	level: BulkLevel;
	scope: BulkScope;
	/** The tools the change applies to (`current`: only those to confirm) */
	tools: ToolPermission[];
	/** Left out: their minimum is stricter than the level they would take */
	kept: ToolPermission[];
	/** Destructive tools among `tools` that end up always allowed */
	destructive: ToolPermission[];
};

/** The level a tool takes in a bulk change (`current`: what the scope has now, as the server) */
const bulkTarget = (tool: ToolPermission, level: BulkLevel, scope: BulkScope): PermissionLevel =>
	level !== 'current'
		? level
		: scope === 'user'
			? tool.chosen
			: (tool.workspaceLevel ?? tool.defaultLevel);

/** The minimum the server enforces for that scope */
const bulkMinimum = (tool: ToolPermission, scope: BulkScope): PermissionLevel =>
	scope === 'user' ? tool.floor : (tool.policyFloor ?? 'allow');

export function bulkPlan(tools: ToolPermission[], level: BulkLevel, scope: BulkScope): BulkPlan {
	const candidates =
		level === 'current' ? tools.filter((tool) => tool.effective.needsConfirmation) : tools;
	const fits = (tool: ToolPermission) =>
		satisfiesFloor(bulkTarget(tool, level, scope), bulkMinimum(tool, scope));
	const applied = candidates.filter(fits);
	return {
		level,
		scope,
		tools: applied,
		kept: candidates.filter((tool) => !fits(tool)),
		destructive: applied.filter(
			(tool) => tool.destructive && bulkTarget(tool, level, scope) === 'allow'
		)
	};
}

const count = (n: number) => `${n} ${n === 1 ? 'tool' : 'tools'}`;

/** "a.b, c.d and 2 more" */
const names = (tools: ToolPermission[], max = 3) => {
	const listed = tools.slice(0, max).map((tool) => tool.path);
	const rest = tools.length - listed.length;
	return rest > 0 ? `${listed.join(', ')} and ${rest} more` : listed.join(', ');
};

/** What a level means for agents, after the change */
const EFFECT: Record<PermissionLevel, string> = {
	allow: 'Agents call them without asking.',
	ask: 'Agents ask for approval before each call.',
	block: 'They are hidden from agents and every call is refused.'
};

/** The menu entry of a plan: "Always allow", or "Always allow (4 of 6)" when some are kept */
export function bulkItemLabel(plan: BulkPlan): string {
	const label = plan.level === 'current' ? 'Confirm' : LEVEL_LABELS[plan.level];
	const total = plan.tools.length + plan.kept.length;
	return plan.kept.length > 0 ? `${label} (${plan.tools.length} of ${total})` : label;
}

/**
 * Title, text and button of the confirmation of a bulk change; `subject` says where the tools
 * are, after "2 tools": "of Dev MCP", "in “Write” of Dev MCP"
 */
export function bulkConfirmation(
	plan: BulkPlan,
	subject: string
): { title: string; description: string; confirmLabel: string; destructive: boolean } {
	const n = count(plan.tools.length);
	const parts: string[] = [];
	let title: string;
	let confirmLabel: string;
	if (plan.level === 'current') {
		const byLevel = new Map<string, number>();
		for (const tool of plan.tools) {
			const label = LEVEL_LABELS[bulkTarget(tool, 'current', plan.scope)];
			byLevel.set(label, (byLevel.get(label) ?? 0) + 1);
		}
		const levels = [...byLevel].map(([label, n]) => `${n} ${label}`);
		title = `Confirm ${n}?`;
		confirmLabel = `Confirm ${n}`;
		parts.push(
			`The current level of ${n} ${subject} is saved as confirmed (${levels.join(', ')}).`
		);
	} else {
		const label = LEVEL_LABELS[plan.level];
		title = `“${label}” for ${n}?`;
		confirmLabel = plan.level === 'allow' ? `Always allow ${n}` : `Set ${n} to “${label}”`;
		parts.push(
			plan.scope === 'user'
				? `Your level for ${n} ${subject} becomes “${label}”.`
				: `The workspace minimum for ${n} ${subject} becomes “${label}”: members cannot choose a looser level, and it is the level of those who have not chosen one.`,
			EFFECT[plan.level]
		);
	}
	const d = plan.destructive.length;
	if (d > 0) {
		const which =
			d < plan.tools.length
				? `${d} of them ${d === 1 ? 'is' : 'are'}`
				: d === 1
					? 'It is'
					: `All ${d} are`;
		parts.push(
			`${which} destructive (${names(plan.destructive)}): agents could delete or overwrite data without asking.`
		);
	}
	const k = plan.kept.length;
	if (k > 0) {
		parts.push(
			plan.level === 'current'
				? `${count(k)} cannot be confirmed at their current level, the workspace minimum is stricter (${names(plan.kept)}): choose a level for ${k === 1 ? 'it' : 'them'}.`
				: `${count(k)} ${k === 1 ? 'keeps its' : 'keep their'} level, the workspace minimum is stricter (${names(plan.kept)}).`
		);
	}
	return { title, description: parts.join(' '), confirmLabel, destructive: d > 0 };
}
