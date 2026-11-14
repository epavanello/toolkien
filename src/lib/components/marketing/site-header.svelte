<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Logo from '#lib/components/brand/logo.svelte';
	import type { SiteLink } from './types.ts';

	/** Top bar of public pages: the wordmark, section links, actions (sign in / get started) */
	let { links, actions }: { links: SiteLink[]; actions?: Snippet } = $props();
</script>

<header class="sticky top-0 z-30 border-b bg-background/90 backdrop-blur" data-slot="site-header">
	<div class="mx-auto flex h-14 max-w-6xl items-center gap-8 px-4 sm:px-6">
		<a href={resolve('/(marketing)')} class="rounded-sm" aria-label="Toolkien home">
			<Logo label="" />
		</a>
		<nav aria-label="Main" class="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
			{#each links as link (link.href)}
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- links come resolved from site config -->
				<a
					href={link.href}
					class="hover:text-foreground"
					rel={link.external ? 'noopener' : undefined}
				>
					{link.label}
				</a>
			{/each}
		</nav>
		{#if actions}<div class="ml-auto flex items-center gap-2">{@render actions()}</div>{/if}
	</div>
</header>
