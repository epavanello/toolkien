<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type KeyValueItem = {
		label: string;
		value?: string | number | Date | null;
		/** How the value renders; `snippet` for anything custom */
		type?: 'text' | 'mono' | 'datetime' | 'status';
		copy?: boolean;
		snippet?: Snippet;
	};
</script>

<script lang="ts">
	import { tv, type VariantProps } from 'tailwind-variants';
	import { formatDateTime } from '#lib/core/format.ts';
	import Mono from './mono.svelte';
	import StatusBadge from './status-badge.svelte';

	const variants = tv({
		base: 'grid gap-x-6 gap-y-2 text-sm',
		variants: {
			columns: {
				1: 'grid-cols-[minmax(8rem,auto)_1fr]',
				2: 'grid-cols-[minmax(8rem,auto)_1fr] lg:grid-cols-[minmax(8rem,auto)_1fr_minmax(8rem,auto)_1fr]'
			}
		},
		defaultVariants: { columns: 1 }
	});

	/** Label/value pairs for detail pages and side panels */
	type Props = { items: KeyValueItem[]; columns?: VariantProps<typeof variants>['columns'] };

	let { items, columns }: Props = $props();
</script>

<dl class={variants({ columns })} data-slot="key-value-list">
	{#each items as item (item.label)}
		<dt class="text-muted-foreground">{item.label}</dt>
		<dd class="min-w-0">
			{#if item.snippet}
				{@render item.snippet()}
			{:else if item.value == null || item.value === ''}
				<span class="text-muted-foreground">—</span>
			{:else if item.type === 'mono'}
				<Mono value={String(item.value)} copy={item.copy} truncate />
			{:else if item.type === 'datetime'}
				<span class="tabular-nums">{formatDateTime(item.value)}</span>
			{:else if item.type === 'status'}
				<StatusBadge status={String(item.value)} />
			{:else}
				{item.value instanceof Date ? formatDateTime(item.value) : item.value}
			{/if}
		</dd>
	{/each}
</dl>
