<script lang="ts">
	import type { Component } from 'svelte';

	/**
	 * Social proof without borrowed logos: what it works with (names as text, with our own client
	 * icons) and an honest early-access line instead of customer logos we do not have yet.
	 */
	type Props = {
		title: string;
		items: { label: string; icon?: Component }[];
		/** Right-hand note (early access, open source) */
		note?: string;
	};

	let { title, items, note }: Props = $props();
</script>

<section class="border-b bg-muted/40" aria-label={title} data-slot="proof-strip">
	<div
		class="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 lg:flex-row lg:items-center lg:gap-8"
	>
		<p class="shrink-0 mono text-xs font-medium tracking-wider text-muted-foreground uppercase">
			{title}
		</p>
		<ul class="flex flex-wrap items-center gap-x-6 gap-y-2">
			{#each items as item (item.label)}
				<li class="flex items-center gap-2 text-sm font-medium">
					{#if item.icon}<item.icon class="size-4 text-muted-foreground" aria-hidden="true" />{/if}
					{item.label}
				</li>
			{/each}
		</ul>
		{#if note}<p class="text-sm text-muted-foreground lg:ml-auto">{note}</p>{/if}
	</div>
</section>
