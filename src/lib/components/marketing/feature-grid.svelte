<script lang="ts">
	import type { Feature } from './types.ts';

	/** Icon + title + one paragraph, in a dense grid of plates */
	let { items, columns = 3 }: { items: Feature[]; columns?: 2 | 3 } = $props();
</script>

<ul
	class="grid gap-px overflow-hidden rounded-lg border bg-border shadow-plate sm:grid-cols-2 {columns ===
	3
		? 'lg:grid-cols-3'
		: ''}"
	data-slot="feature-grid"
>
	{#each items as item (item.title)}
		<li class="flex flex-col gap-2.5 bg-card p-6">
			<span
				class="flex size-8 items-center justify-center rounded-md border bg-primary/10 text-primary"
			>
				<item.icon class="size-4" aria-hidden="true" />
			</span>
			<h3 class="font-semibold">{item.title}</h3>
			<p class="text-sm text-pretty text-muted-foreground">{item.description}</p>
		</li>
	{/each}
</ul>
