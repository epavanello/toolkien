<script lang="ts" module>
	export type TimelineItem = {
		id: string;
		time: Date;
		/** Main label: an event type, a tool path… */
		title: string;
		/** Monospace title (tool paths, ids) */
		mono?: boolean;
		/** Raw domain status, rendered with `StatusBadge` */
		status?: string;
		/** Secondary facts, joined with a dot (user, client, counts) */
		meta?: (string | null | undefined)[];
		durationMs?: number | null;
		/** Grouped rows (events of one execution); the item becomes expandable */
		children?: TimelineItem[];
	};
</script>

<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants';
	import { formatDuration } from '#lib/core/format.ts';
	import EmptyState from './empty-state.svelte';
	import RelativeTime from './relative-time.svelte';
	import StatusBadge from './status-badge.svelte';

	/**
	 * A dense, time-ordered list with expandable groups (activity grouped by execution). Rows
	 * share the table density; groups are real buttons with `aria-expanded`.
	 */
	type Props = {
		items: TimelineItem[];
		label: string;
		empty?: { title: string; description?: string };
		/** Below the list (a "Load more" button) */
		footer?: Snippet;
	};

	let { items, label, empty = { title: 'Nothing yet' }, footer }: Props = $props();

	let open = $state<Record<string, boolean>>({});

	const row = tv({
		slots: {
			root: 'grid min-h-9 grid-cols-[1.25rem_5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-1.5 text-sm',
			time: 'text-xs whitespace-nowrap text-muted-foreground tabular-nums',
			title: 'flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5',
			meta: 'truncate text-xs text-muted-foreground',
			end: 'flex items-center gap-2 text-xs text-muted-foreground tabular-nums'
		},
		variants: {
			child: { true: { root: 'bg-muted/30 pl-8' } },
			mono: { true: { title: 'mono' } }
		}
	});
</script>

{#snippet line(item: TimelineItem, child: boolean, interactive = true)}
	{@const styles = row({ child, mono: item.mono })}
	<span class={styles.time()}><RelativeTime value={item.time} {interactive} /></span>
	<span class={styles.title()}>
		<span class="truncate">{item.title}</span>
		{#if item.meta?.some(Boolean)}
			<span class={styles.meta()}>{item.meta.filter(Boolean).join(' · ')}</span>
		{/if}
	</span>
	<span class={styles.end()}>
		{#if item.durationMs != null}<span>{formatDuration(item.durationMs)}</span>{/if}
		{#if item.status}<StatusBadge status={item.status} />{/if}
	</span>
{/snippet}

<div class="flex flex-col gap-2" data-slot="timeline">
	<div class="overflow-hidden rounded-lg border bg-card">
		{#if items.length === 0}
			<EmptyState icon={Inbox} title={empty.title} description={empty.description} />
		{:else}
			<ul class="divide-y" aria-label={label}>
				{#each items as item (item.id)}
					{@const expanded = !!open[item.id]}
					<li>
						{#if item.children?.length}
							<button
								type="button"
								class="{row().root()} w-full text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
								aria-expanded={expanded}
								onclick={() => (open = { ...open, [item.id]: !expanded })}
							>
								<ChevronRight
									class="size-4 text-muted-foreground transition-transform {expanded
										? 'rotate-90'
										: ''}"
									aria-hidden="true"
								/>
								{@render line(item, false, false)}
							</button>
							{#if expanded}
								<ul class="divide-y border-t" aria-label="{item.title} events">
									{#each item.children as child (child.id)}
										<li class={row({ child: true }).root()}>
											<span></span>
											{@render line(child, true)}
										</li>
									{/each}
								</ul>
							{/if}
						{:else}
							<div class={row().root()}>
								<span></span>
								{@render line(item, false)}
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</div>
	{#if footer}<div class="flex justify-center">{@render footer()}</div>{/if}
</div>
