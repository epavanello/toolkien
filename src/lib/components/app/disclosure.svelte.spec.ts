import { createRawSnippet } from 'svelte';
import { describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import Disclosure from './disclosure.svelte';

const children = createRawSnippet(() => ({ render: () => '<p>Body</p>' }));
const actions = createRawSnippet(() => ({
	render: () => '<button type="button">Set all</button>'
}));

describe('Disclosure', () => {
	it('sticky: the summary sticks, opaque, and tells nested headers its height', async () => {
		const { container } = render(Disclosure, {
			title: 'Dev MCP',
			meta: '6 tools',
			variant: 'flush',
			sticky: true,
			open: true,
			children
		});
		const details = container.querySelector('details')!;
		const summary = details.querySelector('summary')!;
		const style = getComputedStyle(summary);
		expect(style.position).toBe('sticky');
		expect(style.top).toBe('0px');
		expect(style.backgroundColor).not.toMatch(/\/ 0?\.\d|transparent/);
		// Not a scroll container, or the summary would stick to it instead of the page
		expect(getComputedStyle(details).overflow).toBe('clip');
		await expect
			.poll(() => details.style.getPropertyValue('--sticky-top'))
			.toBe(`${summary.offsetHeight}px`);
	});

	it('clicking an action does not fold or unfold the body', async () => {
		const { container } = render(Disclosure, { title: 'Dev MCP', actions, children });
		const details = container.querySelector('details')!;
		await userEvent.click(page.getByRole('button', { name: 'Set all' }));
		expect(details.open).toBe(false);
		await userEvent.click(page.getByText('Dev MCP'));
		expect(details.open).toBe(true);
		await userEvent.click(page.getByRole('button', { name: 'Set all' }));
		expect(details.open).toBe(true);
	});
});
