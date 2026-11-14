<script lang="ts">
	/** Numbered steps (how it works, getting started) */
	let { items }: { items: { title: string; description: string; code?: string }[] } = $props();
</script>

<ol class="grid gap-4 md:grid-cols-3" data-slot="steps">
	{#each items as item, index (item.title)}
		<li class="flex flex-col gap-2">
			<span
				class="flex size-6 items-center justify-center rounded-md border bg-card text-xs font-medium tabular-nums"
				>{index + 1}</span
			>
			<h3 class="text-sm font-semibold">{item.title}</h3>
			<p class="text-sm text-pretty text-muted-foreground">{item.description}</p>
			{#if item.code}<code class="w-fit rounded-sm bg-muted px-1.5 py-0.5 mono text-xs"
					>{item.code}</code
				>{/if}
		</li>
	{/each}
</ol>
