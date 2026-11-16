import { describe, expect, it } from 'vitest';
import type { ToolPermission } from '#lib/server/permissions/types.ts';
import {
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
