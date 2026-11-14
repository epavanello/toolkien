import { error } from '@sveltejs/kit';
import type { Component } from 'svelte';
import type { PageLoad } from './$types';

/**
 * Legal drafts live in `legal/*.md` at the repository root (the source lawyers edit). Each file
 * is compiled by mdsvex and rendered through the standard markdown layout, like any `+page.md`.
 */
const documents = import.meta.glob<{ default: Component }>('/legal/*.md');

export const load: PageLoad = async ({ params }) => {
	const loader = documents[`/legal/${params.document}.md`];
	if (!loader) error(404, 'Not found.', { code: 'NOT_FOUND' });
	return { component: (await loader()).default };
};
