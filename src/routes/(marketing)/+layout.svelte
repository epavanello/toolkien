<script lang="ts">
	import { resolve } from '$app/paths';
	import { SiteFooter, SiteHeader } from '#lib/components/marketing/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { footerGroups, headerLinks, LICENSE } from './site.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="flex min-h-svh flex-col">
	<SiteHeader links={headerLinks}>
		{#snippet actions()}
			<Button size="sm" variant="ghost" href={resolve('/(auth)/login')}>Sign in</Button>
			<Button size="sm" href={resolve('/(auth)/signup')}>Get started</Button>
		{/snippet}
	</SiteHeader>
	<main id="main" class="flex flex-1 flex-col">{@render children()}</main>
	<SiteFooter groups={footerGroups} note="Open source under {LICENSE}. Legal pages are drafts." />
</div>
