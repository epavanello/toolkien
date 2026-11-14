<script lang="ts">
	import { brand } from '#lib/brand.ts';
	import type { SiteLinkGroup } from './types.ts';

	/** Footer of public pages: link groups (product, docs, legal) and the tagline */
	let { groups, note }: { groups: SiteLinkGroup[]; note?: string } = $props();
</script>

<footer class="border-t bg-muted/30" data-slot="site-footer">
	<div
		class="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-[1.5fr_repeat(3,1fr)] sm:px-6"
	>
		<div class="flex flex-col gap-1">
			<p class="font-semibold tracking-tight">{brand.name}</p>
			<p class="text-muted-foreground">{brand.tagline}</p>
			{#if note}<p class="mt-2 text-xs text-muted-foreground">{note}</p>{/if}
		</div>
		{#each groups as group (group.title)}
			<nav aria-label={group.title} class="flex flex-col gap-1.5">
				<p class="text-xs font-medium text-muted-foreground">{group.title}</p>
				{#each group.links as link (link.href)}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- links come resolved from site config -->
					<a
						href={link.href}
						class="w-fit hover:underline"
						rel={link.external ? 'noopener' : undefined}>{link.label}</a
					>
				{/each}
			</nav>
		{/each}
	</div>
</footer>
