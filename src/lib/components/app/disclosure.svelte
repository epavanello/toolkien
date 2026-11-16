<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants';

	/**
	 * Content folded away behind a one-line summary: secondary content (manual setup, advanced
	 * options), or with `variant="flush"` one collapsible list among many (a connector's tools,
	 * with its logo in `media`, badges in `badges` and counts in `meta`). Native `<details>`, so
	 * it works without JavaScript and is keyboard accessible.
	 */
	type Props = {
		title: string;
		description?: string;
		/** Bindable: whether it is open */
		open?: boolean;
		/** `flush`: the body has no padding (rows, `ToolGroupList`) */
		variant?: 'default' | 'flush';
		/** Before the title: a service logo */
		media?: Snippet;
		/** After the title: small badges */
		badges?: Snippet;
		/** Right of the summary: counts, status */
		meta?: string;
		children: Snippet;
	};

	let {
		title,
		description,
		open = $bindable(false),
		variant = 'default',
		media,
		badges,
		meta,
		children
	}: Props = $props();

	const styles = tv({
		slots: {
			root: 'group rounded-lg border bg-card',
			summary:
				'flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2.5 text-sm outline-none select-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden',
			chevron: 'size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90',
			title: 'shrink-0 font-medium',
			description: 'hidden truncate text-muted-foreground sm:inline',
			meta: 'ml-auto shrink-0 text-xs text-muted-foreground tabular-nums',
			body: 'flex flex-col gap-3 border-t px-4 py-3'
		},
		variants: {
			variant: {
				default: {},
				flush: {
					root: 'overflow-hidden',
					summary: 'flex-wrap gap-y-1',
					title: 'min-w-0 shrink truncate',
					body: 'gap-0 p-0'
				}
			}
		}
	});
	const s = $derived(styles({ variant }));
</script>

<details class={s.root()} bind:open data-slot="disclosure">
	<summary class={s.summary()}>
		<ChevronRight class={s.chevron()} aria-hidden="true" />
		{#if media}<span class="shrink-0">{@render media()}</span>{/if}
		<span class={s.title()}>{title}</span>
		{#if badges}{@render badges()}{/if}
		{#if description}<span class={s.description()}>{description}</span>{/if}
		{#if meta}<span class={s.meta()}>{meta}</span>{/if}
	</summary>
	<div class={s.body()}>{@render children()}</div>
</details>
