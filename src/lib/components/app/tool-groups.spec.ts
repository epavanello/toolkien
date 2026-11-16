import { describe, expect, it } from 'vitest';
import { groupTools, toolGroup } from './tool-groups.ts';

describe('toolGroup', () => {
	it('classifies tools like the permission defaults', () => {
		expect(toolGroup({ readOnlyHint: true })).toBe('read');
		expect(toolGroup({ readOnlyHint: false })).toBe('write');
		expect(toolGroup({ idempotentHint: true })).toBe('write');
		expect(toolGroup({ destructiveHint: true })).toBe('destructive');
		// A tool that claims both is not trusted as read only
		expect(toolGroup({ readOnlyHint: true, destructiveHint: true })).toBe('destructive');
		expect(toolGroup(null)).toBe('unannotated');
	});
});

describe('groupTools', () => {
	it('keeps non-empty groups in reading order and items in their order', () => {
		const tools = [
			{ name: 'delete', annotations: { destructiveHint: true } },
			{ name: 'list', annotations: { readOnlyHint: true } },
			{ name: 'raw', annotations: null },
			{ name: 'get', annotations: { readOnlyHint: true } }
		];
		const groups = groupTools(tools, (tool) => tool.annotations);
		expect(groups.map((group) => [group.key, group.items.map((tool) => tool.name)])).toEqual([
			['read', ['list', 'get']],
			['destructive', ['delete']],
			['unannotated', ['raw']]
		]);
		expect(groups[0].title).toBe('Read only');
	});

	it('returns no group for no tools', () => {
		expect(groupTools([], () => null)).toEqual([]);
	});
});
