<script lang="ts">
	import type { Feature } from './types.ts';

	/** Icon + title + one paragraph, in a dense grid */
	let { items, columns = 3 }: { items: Feature[]; columns?: 2 | 3 } = $props();
</script>

<ul
	class="grid gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-2 {columns === 3
		? 'lg:grid-cols-3'
		: ''}"
	data-slot="feature-grid"
>
	{#each items as item (item.title)}
		<li class="flex flex-col gap-2 bg-card p-5">
			<item.icon class="size-4 text-primary" aria-hidden="true" />
			<h3 class="text-sm font-semibold">{item.title}</h3>
			<p class="text-sm text-pretty text-muted-foreground">{item.description}</p>
		</li>
	{/each}
</ul>
