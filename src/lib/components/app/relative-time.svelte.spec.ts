import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import RelativeTime from './relative-time.svelte';

describe('RelativeTime', () => {
	it('renders a short label in a <time datetime>, with the full date for screen readers', async () => {
		const value = new Date(Date.now() - 2 * 60_000);
		// The tooltip variant needs the app's Tooltip.Provider; the label is the same
		const { container } = render(RelativeTime, { value, interactive: false });
		await expect.element(page.getByText('2 min ago')).toBeInTheDocument();
		const time = container.querySelector('time')!;
		expect(time.getAttribute('datetime')).toBe(value.toISOString());
		expect(time.querySelector('.sr-only')?.textContent).toMatch(String(value.getFullYear()));
		expect(time.title).toBe(time.querySelector('.sr-only')?.textContent);
	});

	it('keeps calendar dates as days and shows a dash for missing values', async () => {
		const { container } = render(RelativeTime, { value: '2020-03-04', interactive: false });
		await expect.element(page.getByText('4 Mar 2020')).toBeInTheDocument();
		expect(container.querySelector('time')?.getAttribute('datetime')).toBe('2020-03-04');
		render(RelativeTime, { value: null });
		await expect.element(page.getByText('—')).toBeInTheDocument();
	});
});
