import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import EmptyState from './empty-state.svelte';

describe('EmptyState', () => {
	it('renders title and description', async () => {
		render(EmptyState, { title: 'No connectors yet', description: 'Add one from the directory.' });
		await expect.element(page.getByText('No connectors yet')).toBeInTheDocument();
		await expect.element(page.getByText('Add one from the directory.')).toBeInTheDocument();
	});
});
