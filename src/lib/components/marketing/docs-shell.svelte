<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import { embedMarkdownPages } from '#lib/components/markdown/markdown-layout.svelte';
	import type { SiteLinkGroup } from './types.ts';

	/**
	 * Docs frame: sidebar from one nav data file, the markdown page, previous/next links. Markdown
	 * pages inside render without their own container (`embedMarkdownPages`).
	 */
	type Props = { groups: SiteLinkGroup[]; current: string; children: Snippet };

	let { groups, current, children }: Props = $props();

	embedMarkdownPages();

	const flat = $derived(groups.flatMap((group) => group.links));
	const index = $derived(flat.findIndex((link) => link.href === current));
	const previous = $derived(index > 0 ? flat[index - 1] : null);
	const next = $derived(index >= 0 && index < flat.length - 1 ? flat[index + 1] : null);
</script>

<div
	class="mx-auto grid w-full max-w-6xl gap-8 px-4 py-8 sm:px-6 md:grid-cols-[13rem_minmax(0,1fr)]"
	data-slot="docs-shell"
>
	<nav
		aria-label="Documentation"
		class="flex flex-col gap-5 text-sm md:sticky md:top-16 md:self-start"
	>
		{#each groups as group (group.title)}
			<div class="flex flex-col gap-1">
				<p class="mono text-xs font-medium tracking-wider text-muted-foreground uppercase">
					{group.title}
				</p>
				{#each group.links as link (link.href)}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved in the nav data -->
					<a
						href={link.href}
						aria-current={link.href === current ? 'page' : undefined}
						class="rounded-sm border-l-2 border-transparent px-2 py-1 text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:bg-muted aria-[current=page]:font-medium aria-[current=page]:text-foreground"
					>
						{link.label}
					</a>
				{/each}
			</div>
		{/each}
	</nav>
	<div class="flex min-w-0 flex-col gap-10">
		{@render children()}
		{#if previous || next}
			<nav aria-label="Previous and next" class="flex justify-between gap-4 border-t pt-4 text-sm">
				{#if previous}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved in the nav data -->
					<a
						href={previous.href}
						class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
					>
						<ChevronLeft class="size-4" />{previous.label}
					</a>
				{:else}<span></span>{/if}
				{#if next}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- resolved in the nav data -->
					<a
						href={next.href}
						class="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
					>
						{next.label}<ChevronRight class="size-4" />
					</a>
				{/if}
			</nav>
		{/if}
	</div>
</div>
