import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import StatusBadge from './status-badge.svelte';

describe('StatusBadge', () => {
	it('derives label and tone from the raw status', async () => {
		render(StatusBadge, { status: 'pending_auth' });
		const badge = page.getByText('Pending auth');
		await expect.element(badge).toBeInTheDocument();
		expect(badge.element().className).toContain('text-warning');
	});
});
