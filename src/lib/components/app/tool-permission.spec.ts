import { describe, expect, it } from 'vitest';
import type { ToolPermission } from '#lib/server/permissions/types.ts';
import {
	bulkConfirmation,
	bulkItemLabel,
	bulkPlan,
	filterPermissions,
	groupDefault,
	matchesLevel,
	permissionSummary
} from './tool-permission.ts';

const tool = (overrides: Partial<ToolPermission> = {}): ToolPermission => ({
	toolId: 't1',
	path: 'github.listIssues',
	connectorId: 'c1',
	connectorName: 'GitHub',
	source: 'directory',
	unverified: false,
	readOnly: true,
	destructive: false,
	unannotated: false,
	annotations: { readOnlyHint: true },
	effective: { level: 'allow', needsConfirmation: false, source: 'default' },
	defaultLevel: 'allow',
	chosen: 'allow',
	userLevel: null,
	workspaceLevel: null,
	floor: 'allow',
	policyFloor: null,
	...overrides
});

const toConfirm = tool({
	toolId: 't2',
	path: 'github.createIssue',
	defaultLevel: 'ask',
	effective: { level: 'ask', needsConfirmation: true, source: 'default' }
});
const blocked = tool({
	toolId: 't3',
	path: 'linear.deleteIssue',
	connectorName: 'Linear',
	effective: { level: 'block', needsConfirmation: false, source: 'user' }
});

describe('matchesLevel', () => {
	it('matches the effective level, "to confirm" and the empty "All" value', () => {
		expect(matchesLevel(tool(), 'allow')).toBe(true);
		expect(matchesLevel(tool(), 'ask')).toBe(false);
		expect(matchesLevel(toConfirm, 'confirm')).toBe(true);
		expect(matchesLevel(tool(), 'confirm')).toBe(false);
		expect(matchesLevel(blocked, '')).toBe(true);
	});
});

describe('filterPermissions', () => {
	const tools = [tool(), toConfirm, blocked];

	it('searches paths and connector names, case-insensitively', () => {
		expect(filterPermissions(tools, 'CREATE', '').map((t) => t.toolId)).toEqual(['t2']);
		expect(filterPermissions(tools, ' linear ', '').map((t) => t.toolId)).toEqual(['t3']);
	});

	it('combines the search with the level filter', () => {
		expect(filterPermissions(tools, 'github', 'confirm').map((t) => t.toolId)).toEqual(['t2']);
		expect(filterPermissions(tools, '', '')).toHaveLength(3);
	});
});

describe('groupDefault', () => {
	it('shows the default shared by the group', () => {
		expect(groupDefault([tool(), tool({ toolId: 't4' })])).toBe('Default: Always allow');
	});

	it('says "Proposed" when the connector is unverified', () => {
		expect(groupDefault([tool({ unverified: true, defaultLevel: 'ask' })])).toBe('Proposed: Ask');
	});

	it('shows nothing when the defaults differ or the group is empty', () => {
		expect(groupDefault([tool(), toConfirm])).toBeNull();
		expect(groupDefault([])).toBeNull();
	});
});

describe('permissionSummary', () => {
	it('counts tools, tools to confirm and blocked tools', () => {
		expect(permissionSummary([tool()])).toBe('1 tool');
		expect(permissionSummary([tool(), toConfirm, blocked])).toBe(
			'3 tools · 1 to confirm · 1 blocked'
		);
	});
});

describe('bulkPlan', () => {
	const destructive = tool({
		toolId: 't5',
		path: 'github.deleteBranch',
		destructive: true,
		readOnly: false,
		chosen: 'ask'
	});
	const floored = tool({ toolId: 't6', path: 'github.merge', floor: 'ask', workspaceLevel: 'ask' });

	it('leaves out the tools whose minimum forbids the level, as the server would refuse them', () => {
		const plan = bulkPlan([tool(), destructive, floored], 'allow', 'user');
		expect(plan.tools.map((t) => t.toolId)).toEqual(['t1', 't5']);
		expect(plan.kept.map((t) => t.toolId)).toEqual(['t6']);
		expect(plan.destructive.map((t) => t.toolId)).toEqual(['t5']);
		// A stricter level fits every tool
		expect(bulkPlan([tool(), floored], 'block', 'user').kept).toEqual([]);
	});

	it('uses the policy floor (not the workspace row) for the workspace minimum', () => {
		expect(bulkPlan([floored], 'allow', 'workspace').tools).toHaveLength(1);
		const strict = tool({ policyFloor: 'ask', floor: 'ask' });
		expect(bulkPlan([strict], 'allow', 'workspace').kept).toHaveLength(1);
	});

	it('"current" plans only the tools to confirm, at their current level', () => {
		const below = tool({
			toolId: 't7',
			chosen: 'allow',
			floor: 'ask',
			effective: { level: 'ask', needsConfirmation: true, source: 'user' }
		});
		const plan = bulkPlan([tool(), toConfirm, below], 'current', 'user');
		expect(plan.tools.map((t) => t.toolId)).toEqual(['t2']);
		expect(plan.kept.map((t) => t.toolId)).toEqual(['t7']);
	});
});

describe('bulkConfirmation', () => {
	const many = [tool(), tool({ toolId: 't8', path: 'github.getIssue' })];

	it('states the count, the scope and what the level means', () => {
		const text = bulkConfirmation(bulkPlan(many, 'block', 'user'), 'of GitHub');
		expect(text).toEqual({
			title: '“Blocked” for 2 tools?',
			description:
				'Your level for 2 tools of GitHub becomes “Blocked”. They are hidden from agents and every call is refused.',
			confirmLabel: 'Set 2 tools to “Blocked”',
			destructive: false
		});
		expect(bulkConfirmation(bulkPlan(many, 'ask', 'workspace'), 'of GitHub').description).toContain(
			'The workspace minimum for 2 tools of GitHub becomes “Ask”'
		);
	});

	it('is explicit about allowing destructive tools and names the tools left out', () => {
		const destructive = tool({ toolId: 't5', path: 'github.deleteBranch', destructive: true });
		const floored = tool({ toolId: 't6', path: 'github.merge', floor: 'block' });
		const text = bulkConfirmation(
			bulkPlan([tool(), destructive, floored], 'allow', 'user'),
			'of GitHub'
		);
		expect(text.destructive).toBe(true);
		expect(text.confirmLabel).toBe('Always allow 2 tools');
		expect(text.description).toContain(
			'1 of them is destructive (github.deleteBranch): agents could delete or overwrite data without asking.'
		);
		expect(text.description).toContain(
			'1 tool keeps its level, the workspace minimum is stricter (github.merge).'
		);
		expect(
			bulkConfirmation(bulkPlan([destructive], 'allow', 'user'), 'of GitHub').description
		).toContain('It is destructive (github.deleteBranch)');
	});

	it('summarises the levels being confirmed', () => {
		const text = bulkConfirmation(
			bulkPlan(
				[
					{ ...toConfirm, chosen: 'ask' },
					{ ...toConfirm, toolId: 't9' }
				],
				'current',
				'user'
			),
			'of GitHub'
		);
		expect(text.title).toBe('Confirm 2 tools?');
		expect(text.description).toContain('(1 Ask, 1 Always allow)');
	});
});

describe('bulkItemLabel', () => {
	it('shows how many tools take the level when some are left out', () => {
		const floored = tool({ toolId: 't6', floor: 'ask' });
		expect(bulkItemLabel(bulkPlan([tool(), floored], 'allow', 'user'))).toBe(
			'Always allow (1 of 2)'
		);
		expect(bulkItemLabel(bulkPlan([tool(), floored], 'ask', 'user'))).toBe('Ask');
	});
});
