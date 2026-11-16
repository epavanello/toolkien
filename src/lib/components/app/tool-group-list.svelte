<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants';
	import type { ToolAnnotations } from '#lib/server/db/schema/connectors.ts';
	import { groupTools } from './tool-groups.ts';

	/**
	 * Rows of tools under one header per operation type (read only, write, destructive, not
	 * declared: `groupTools`), with the count of each group. Lives in a `Section variant="flush"`
	 * or a flush `Disclosure`; rows are rendered by `row` (`ToolDefinition`, `ToolPermissionRow`).
	 */
	type Props = {
		items: T[];
		annotations: (item: T) => ToolAnnotations | null;
		key: (item: T) => string;
		row: Snippet<[T]>;
		/** Short text at the right of a group header (e.g. the group's default level) */
		note?: (items: T[]) => string | null | undefined;
	};

	let { items, annotations, key, row, note }: Props = $props();

	const styles = tv({
		slots: {
			header: 'flex items-baseline gap-2 border-b bg-muted/40 px-4 py-1.5 text-xs',
			title: 'shrink-0 font-medium',
			description: 'hidden min-w-0 truncate text-muted-foreground sm:inline',
			note: 'ml-auto shrink-0 text-muted-foreground'
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
	<div class={s.header()} role="heading" aria-level={3} data-slot="tool-group">
		<span class={s.title()}>{group.title} · {group.items.length}</span>
		<span class={s.description()}>{group.description}</span>
		{#if text}<span class={s.note()}>{text}</span>{/if}
	</div>
	{#each group.items as item (key(item))}
		{@render row(item)}
	{/each}
{/each}
