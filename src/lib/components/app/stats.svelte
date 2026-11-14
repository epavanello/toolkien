<script lang="ts" module>
	import type { Tone } from './status.ts';

	export type StatItem = {
		label: string;
		value: string | number;
		/** Small line under the value (period, comparison) */
		hint?: string;
		tone?: Tone;
	};
</script>

<script lang="ts">
	import { tv } from 'tailwind-variants';
	import { formatNumber } from '#lib/core/format.ts';

	/** A strip of key numbers (usage, counts) */
	let { items }: { items: StatItem[] } = $props();

	const value = tv({
		base: 'text-xl font-semibold tabular-nums',
		variants: {
			tone: {
				success: 'text-success',
				pending: 'text-warning',
				error: 'text-destructive',
				neutral: ''
			}
		},
		defaultVariants: { tone: 'neutral' }
	});
</script>

<dl
	class="grid grid-cols-2 divide-x divide-y rounded-lg border bg-card sm:grid-cols-4 sm:divide-y-0"
>
	{#each items as item (item.label)}
		<div class="flex flex-col gap-0.5 px-4 py-3">
			<dt class="text-xs text-muted-foreground">{item.label}</dt>
			<dd class={value({ tone: item.tone })}>
				{typeof item.value === 'number' ? formatNumber(item.value) : item.value}
			</dd>
			{#if item.hint}<dd class="text-xs text-muted-foreground">{item.hint}</dd>{/if}
		</div>
	{/each}
</dl>
