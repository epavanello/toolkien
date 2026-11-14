<script lang="ts" module>
	/** One measured quantity; `amount` (0–1) sets the bar length relative to the other panel */
	export type CompareMetric = { label: string; value: string; amount: number };

	/**
	 * How a panel draws its situation:
	 * - `calls`: a long ladder of round trips (agent ↔ tool), `count` rungs
	 * - `script`: one script block with its few calls folded inside
	 * - `mesh`: a grid of setups, `rows` × `columns` dots (every client × every tool)
	 * - `hub`: the same tools and clients, each connected once to the hub
	 */
	export type CompareVisual =
		| { kind: 'calls'; count: number }
		| { kind: 'script'; lines: string[] }
		| { kind: 'mesh'; rows: string[]; columns: number }
		| { kind: 'hub'; rows: string[]; columns: number };

	export type ComparePanel = {
		label: string;
		title: string;
		visual: CompareVisual;
		metrics: CompareMetric[];
	};
</script>

<script lang="ts">
	import Hallmark from './hallmark.svelte';

	/**
	 * Before / after, side by side: a small drawing of each situation and the same metrics as
	 * bars. `note` says where the numbers come from (illustrative examples must say so).
	 */
	let { before, after, note }: { before: ComparePanel; after: ComparePanel; note?: string } =
		$props();
</script>

{#snippet panel(item: ComparePanel, featured: boolean)}
	<li
		class="flex min-w-0 flex-col gap-5 rounded-lg border bg-card p-5 shadow-plate sm:p-6 {featured
			? 'border-primary/50 ring-1 ring-primary/20'
			: ''}"
	>
		<div class="flex flex-col gap-2">
			<Hallmark tone={featured ? 'ember' : 'muted'}>{item.label}</Hallmark>
			<h3 class="font-display text-2xl font-semibold text-balance">{item.title}</h3>
		</div>

		<div class="min-h-28 overflow-x-auto rounded-md border bg-muted/40 p-3" aria-hidden="true">
			{#if item.visual.kind === 'calls'}
				<div class="flex flex-wrap gap-1">
					{#each { length: item.visual.count }, index (index)}
						<span
							class="h-2 w-6 rounded-full {index % 2 === 0
								? 'bg-foreground/25'
								: 'bg-foreground/45'}"
						></span>
					{/each}
				</div>
			{:else if item.visual.kind === 'script'}
				<div class="flex flex-col mono text-xs leading-relaxed text-muted-foreground">
					{#each item.visual.lines as line, index (index)}
						<span class="whitespace-pre {index === 0 ? 'text-primary' : ''}">{line}</span>
					{/each}
				</div>
			{:else}
				{@const hub = item.visual.kind === 'hub'}
				{@const columns = item.visual.columns}
				<div class="flex flex-col gap-1.5">
					{#each item.visual.rows as row, index (row)}
						<div class="flex items-center gap-2">
							<span class="w-16 shrink-0 truncate text-xs text-muted-foreground">{row}</span>
							<span class="flex gap-1">
								{#if hub}
									<span class="size-2.5 rounded-full bg-primary"></span>
								{:else}
									{#each { length: columns }, column (column)}
										<span class="size-2.5 rounded-full bg-foreground/35"></span>
									{/each}
								{/if}
							</span>
						</div>
						{#if hub && index === item.visual.rows.length - 1}
							<div class="flex items-center gap-2">
								<span class="w-16 shrink-0 truncate text-xs font-medium">Toolkien</span>
								<span class="flex gap-1">
									{#each { length: columns }, column (column)}
										<span class="size-2.5 rounded-full bg-primary"></span>
									{/each}
								</span>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		</div>

		<dl class="flex flex-col gap-3">
			{#each item.metrics as metric (metric.label)}
				<div class="flex flex-col gap-1">
					<div class="flex items-baseline justify-between gap-3 text-sm">
						<dt class="text-muted-foreground">{metric.label}</dt>
						<dd class="font-semibold tabular-nums">{metric.value}</dd>
					</div>
					<div class="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
						<div
							class="h-full rounded-full {featured ? 'bg-primary' : 'bg-foreground/40'}"
							style:width="{Math.max(2, Math.round(metric.amount * 100))}%"
						></div>
					</div>
				</div>
			{/each}
		</dl>
	</li>
{/snippet}

<div class="flex flex-col gap-3" data-slot="compare">
	<ul class="grid gap-4 md:grid-cols-2">
		{@render panel(before, false)}
		{@render panel(after, true)}
	</ul>
	{#if note}<p class="text-xs text-muted-foreground">{note}</p>{/if}
</div>
