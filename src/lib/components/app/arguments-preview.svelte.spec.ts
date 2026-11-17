import { describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type { PreviewValue } from '#lib/server/bridge/content.ts';
import ArgumentsPreview from './arguments-preview.svelte';

const branch = 'https://github.com/acme/app/tree/feat/TASK-7218-aria-step-pacing';

const value: PreviewValue = {
	kind: 'fields',
	more: 0,
	fields: [
		{ key: 'page_id', value: { kind: 'text', text: '41b16798-7ac6-819c-aad7-fb276a318468' } },
		{ key: 'command', value: { kind: 'text', text: 'update_properties' } },
		{ key: 'allow_async', value: { kind: 'text', text: 'false' } },
		{
			key: 'properties',
			value: {
				kind: 'fields',
				more: 0,
				fields: [
					{ key: 'Branch', value: { kind: 'text', text: branch } },
					{
						key: 'Pull Request',
						value: { kind: 'text', text: 'https://github.com/acme/app/pull/971' }
					}
				]
			}
		},
		{ key: 'tags', value: { kind: 'json', text: '[\n  "a",\n  "b"\n]' } }
	]
};

describe('ArgumentsPreview', () => {
	it('shows each field, nested objects as sub-fields, in full', async () => {
		render(ArgumentsPreview, { value });
		await expect.element(page.getByText('properties', { exact: true })).toBeInTheDocument();
		await expect.element(page.getByText('Pull Request')).toBeInTheDocument();
		await expect.element(page.getByText(branch)).toBeInTheDocument();
		await expect.element(page.getByText('update_properties')).toBeInTheDocument();
		// Plain text: a URL is not a link on the approval page
		expect(document.querySelector('a')).toBeNull();
	});
});
