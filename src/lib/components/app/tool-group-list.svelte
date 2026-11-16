<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants';
	import type { ToolAnnotations } from '#lib/server/db/schema/connectors.ts';
	import { groupTools, type ToolGroup } from './tool-groups.ts';

	/**
	 * Rows of tools under one header per operation type (read only, write, destructive, not
	 * declared: `groupTools`), with the count of each group. Lives in a `Section variant="flush"`
	 * or a flush `Disclosure`; rows are rendered by `row` (`ToolDefinition`, `ToolPermissionRow`).
	 * Headers stick to the top of the scrolling page or panel while their group scrolls, below a
	 * sticky `Disclosure` summary (`--sticky-top`); they are opaque, so rows never show through.
	 */
	type Props = {
		items: T[];
		annotations: (item: T) => ToolAnnotations | null;
		key: (item: T) => string;
		row: Snippet<[T]>;
		/** Short text at the right of a group header (e.g. the group's default level) */
		note?: (items: T[]) => string | null | undefined;
		/** Controls at the right of a group header (e.g. `BulkLevelMenu` for the group's tools) */
		actions?: Snippet<[T[], ToolGroup]>;
	};

	let { items, annotations, key, row, note, actions }: Props = $props();

	const styles = tv({
		slots: {
			// One box per group: a sticky header stays within its own group
			group: 'border-b last:border-b-0',
			header:
				'sticky top-[var(--sticky-top,0px)] z-20 flex min-h-8 items-center gap-2 border-b bg-muted-solid px-4 py-1 text-xs',
			heading: 'flex min-w-0 flex-1 items-baseline gap-2',
			title: 'shrink-0 font-medium',
			description: 'hidden min-w-0 truncate text-muted-foreground sm:inline',
			note: 'ml-auto shrink-0 text-muted-foreground',
			actions: 'flex shrink-0 items-center gap-1'
		},
		variants: {
			group: {
				read: { title: 'text-success' },
				write: {},
				destructive: { title: 'text-destructive' },
				unannotated: {}
			}
		}
	});

	const groups = $derived(groupTools(items, annotations));
</script>

{#each groups as group (group.key)}
	{@const s = styles({ group: group.key })}
	{@const text = note?.(group.items)}
	<div class={s.group()} data-slot="tool-group">
		<div class={s.header()} data-slot="tool-group-header">
			<span class={s.heading()} role="heading" aria-level={3}>
				<span class={s.title()}>{group.title} · {group.items.length}</span>
				<span class={s.description()}>{group.description}</span>
				{#if text}<span class={s.note()}>{text}</span>{/if}
			</span>
			{#if actions}<span class={s.actions()}>{@render actions(group.items, group)}</span>{/if}
		</div>
		{#each group.items as item (key(item))}
			{@render row(item)}
		{/each}
	</div>
{/each}
