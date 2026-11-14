<script lang="ts" module>
	export type PathCard = {
		/** Small label above the title (e.g. "Recommended") */
		label: string;
		title: string;
		description: string;
		/** Short facts, one line each */
		points: string[];
		/** Highlighted card (the managed service) */
		featured?: boolean;
		/** Command or snippet shown in mono (e.g. `docker compose up -d`) */
		code?: string;
	};
</script>

<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import type { Snippet } from 'svelte';
	import Hallmark from './hallmark.svelte';

	/**
	 * Two (or three) ways to get the product, side by side: the featured one first (managed),
	 * then self-hosting. Each card ends with its own actions.
	 */
	let { items, actions }: { items: PathCard[]; actions: Snippet<[PathCard, number]> } = $props();
</script>

<ul class="grid gap-4 md:grid-cols-2" data-slot="path-cards">
	{#each items as item, index (item.title)}
		<li
			class="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-6 shadow-plate {item.featured
				? 'border-primary/50 ring-1 ring-primary/20'
				: ''}"
		>
			<Hallmark tone={item.featured ? 'ember' : 'muted'}>{item.label}</Hallmark>
			<div class="flex flex-col gap-1.5">
				<h3 class="font-display text-2xl font-semibold">{item.title}</h3>
				<p class="text-sm text-pretty text-muted-foreground">{item.description}</p>
			</div>
			<ul class="flex flex-col gap-1.5 text-sm">
				{#each item.points as point (point)}
					<li class="flex gap-2">
						<Check class="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />{point}
					</li>
				{/each}
			</ul>
			{#if item.code}
				<code class="w-fit rounded-md border bg-muted px-2.5 py-1.5 mono text-xs">{item.code}</code>
			{/if}
			<div class="mt-auto flex flex-wrap gap-2 pt-2">{@render actions(item, index)}</div>
		</li>
	{/each}
</ul>
