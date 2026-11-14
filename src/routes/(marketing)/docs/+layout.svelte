<script lang="ts">
	import { page } from '$app/state';
	import { DocsShell } from '#lib/components/marketing/index.ts';
	import { docsNavGroups } from './nav.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();

	const current = $derived(page.url.pathname.replace(/\/$/, '') || '/docs');
</script>

<DocsShell groups={docsNavGroups()} {current}>{@render children()}</DocsShell>
