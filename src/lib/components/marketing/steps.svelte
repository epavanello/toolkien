<script lang="ts">
	/**
	 * Numbered steps (how it works, getting started): plates with a display numeral in ember and
	 * the tool name in mono.
	 */
	let { items }: { items: { title: string; description: string; code?: string }[] } = $props();
</script>

<ol class="grid gap-4 md:grid-cols-3" data-slot="steps">
	{#each items as item, index (item.title)}
		<li class="flex flex-col gap-3 rounded-lg border bg-card p-5 shadow-plate">
			<div class="flex items-baseline justify-between gap-3">
				<span class="font-display text-4xl leading-none font-semibold text-primary tabular-nums"
					>{index + 1}</span
				>
				{#if item.code}<code class="rounded-sm bg-muted px-1.5 py-0.5 mono text-xs"
						>{item.code}</code
					>{/if}
			</div>
			<h3 class="font-display text-xl font-semibold">{item.title}</h3>
			<p class="text-sm text-pretty text-muted-foreground">{item.description}</p>
		</li>
	{/each}
</ol>
