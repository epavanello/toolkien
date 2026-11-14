<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { brand } from '#lib/brand.ts';
	import type { SiteLink } from './types.ts';

	/** Top bar of public pages: brand, section links, actions (sign in / get started) */
	let { links, actions }: { links: SiteLink[]; actions?: Snippet } = $props();
</script>

<header class="sticky top-0 z-30 border-b bg-background/95 backdrop-blur" data-slot="site-header">
	<div class="mx-auto flex h-12 max-w-6xl items-center gap-6 px-4 sm:px-6">
		<a href={resolve('/(marketing)')} class="text-sm font-semibold tracking-tight">{brand.name}</a>
		<nav aria-label="Main" class="hidden items-center gap-4 text-sm text-muted-foreground sm:flex">
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
