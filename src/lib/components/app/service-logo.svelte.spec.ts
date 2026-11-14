import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import ServiceLogo, { monogram, monogramTone } from './service-logo.svelte';

describe('ServiceLogo', () => {
	it('shows the served icon next to the name', async () => {
		const { container } = render(ServiceLogo, {
			name: 'Linear',
			src: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
			withName: true
		});
		await expect.element(page.getByText('Linear')).toBeInTheDocument();
		expect(container.querySelector('img')?.getAttribute('alt')).toBe('');
	});

	it('falls back to a monogram with a color derived from the name', async () => {
		const { container } = render(ServiceLogo, { name: 'mcp.acme.dev', src: null });
		await expect.element(page.getByText('M')).toBeInTheDocument();
		expect(container.querySelector('img')).toBeNull();
		expect(monogram('2fa')).toBe('2');
		expect(monogramTone('Acme')).toBe(monogramTone('acme'));
	});
});
