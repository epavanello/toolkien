import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { ToolAnnotations } from '#lib/server/db/schema/connectors.ts';
import '../../../routes/layout.css';
import type { ToolGroup } from './tool-groups.ts';
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

	it('puts the group’s actions in its header, outside the heading', async () => {
		const actions = createRawSnippet((tools: () => Item[], group: () => ToolGroup) => ({
			render: () =>
				`<button type="button">Set all ${group().key}: ${tools()
					.map((tool) => tool.id)
					.join(' ')}</button>`
		}));
		render(ToolGroupList<Item>, {
			items,
			annotations: (item) => item.annotations,
			key: (item) => item.id,
			row,
			actions
		});
		await expect
			.element(
				page.getByRole('button', { name: 'Set all read: github.getIssue github.listIssues' })
			)
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Set all destructive: github.deleteBranch' }))
			.toBeInTheDocument();
		await expect
			.element(page.getByRole('heading', { level: 3 }).first())
			.not.toHaveTextContent('Set all');
	});

	it('headers stick below the enclosing sticky header (--sticky-top) and are opaque', async () => {
		const { container } = render(ToolGroupList<Item>, {
			items,
			annotations: (item) => item.annotations,
			key: (item) => item.id,
			row
		});
		container.style.setProperty('--sticky-top', '45px');
		const headers = container.querySelectorAll<HTMLElement>('[data-slot=tool-group-header]');
		expect(headers).toHaveLength(2);
		for (const header of headers) {
			const style = getComputedStyle(header);
			expect(style.position).toBe('sticky');
			expect(style.top).toBe('45px');
			expect(Number(style.zIndex)).toBeGreaterThan(0);
			// No alpha: rows scrolling under the header never show through
			expect(style.backgroundColor).not.toMatch(/\/ 0?\.\d|, 0?\.\d+\)$|transparent/);
		}
		// Each header lives in its own group box, so it leaves with its group
		expect(headers[0].parentElement).not.toBe(headers[1].parentElement);
	});
});
