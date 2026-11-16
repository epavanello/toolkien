import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { ToolAnnotations } from '#lib/server/db/schema/connectors.ts';
import ToolGroupList from './tool-group-list.svelte';

type Item = { id: string; annotations: ToolAnnotations | null };

const items: Item[] = [
	{ id: 'github.deleteBranch', annotations: { destructiveHint: true } },
	{ id: 'github.getIssue', annotations: { readOnlyHint: true } },
	{ id: 'github.listIssues', annotations: { readOnlyHint: true } }
];

const row = createRawSnippet((item: () => Item) => ({
	render: () => `<p data-testid="row">${item().id}</p>`
}));

describe('ToolGroupList', () => {
	it('renders one header per operation type with its count, then its rows', async () => {
		render(ToolGroupList<Item>, {
			items,
			annotations: (item) => item.annotations,
			key: (item) => item.id,
			row,
			note: (group) => (group.length > 1 ? 'Default: Always allow' : null)
		});
		const headings = page.getByRole('heading', { level: 3 });
		await expect.element(headings.nth(0)).toHaveTextContent('Read only · 2');
		await expect.element(headings.nth(0)).toHaveTextContent('Default: Always allow');
		await expect.element(headings.nth(1)).toHaveTextContent('Destructive · 1');
		await expect.element(headings.nth(1)).not.toHaveTextContent('Default');
		expect(headings.elements()).toHaveLength(2);
		expect(
			page
				.getByTestId('row')
				.elements()
				.map((el) => el.textContent)
		).toEqual(['github.getIssue', 'github.listIssues', 'github.deleteBranch']);
	});
});
