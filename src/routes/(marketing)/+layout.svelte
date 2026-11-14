<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { resolve } from '$app/paths';
	import { SiteFooter, SiteHeader } from '#lib/components/marketing/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { footerGroups, headerLinks, LICENSE } from './site.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<div class="flex min-h-svh flex-col">
	<SiteHeader links={headerLinks}>
		{#snippet actions()}
			{#if data.signedIn}
				<!-- `/` sends signed-in users to their workspace -->
				<Button size="sm" variant="outline" icon={ArrowLeft} href={resolve('/(marketing)')}>
					Back to app
				</Button>
			{:else}
				<Button size="sm" variant="ghost" href={resolve('/(auth)/login')}>Sign in</Button>
				<Button size="sm" href={resolve('/(auth)/signup')}>Get started</Button>
			{/if}
		{/snippet}
	</SiteHeader>
	<main id="main" class="flex flex-1 flex-col">{@render children()}</main>
	<SiteFooter groups={footerGroups} note="Open source under {LICENSE}. Legal pages are drafts." />
</div>
