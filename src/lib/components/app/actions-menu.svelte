<script lang="ts" module>
	import type { Component } from 'svelte';

	export type ActionItem = {
		label: string;
		icon?: Component;
		onSelect: () => unknown;
		variant?: 'default' | 'destructive';
		disabled?: boolean;
		hidden?: boolean;
	};
</script>

<script lang="ts">
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';

	/** The "⋯" menu of a row or a detail page */
	let { actions, label = 'Actions' }: { actions: ActionItem[]; label?: string } = $props();

	const visible = $derived(actions.filter((action) => !action.hidden));
</script>

{#if visible.length > 0}
	<DropdownMenu.Root>
		<DropdownMenu.Trigger>
			{#snippet child({ props })}
				<Button variant="ghost" size="icon-xs" icon={Ellipsis} aria-label={label} {...props} />
			{/snippet}
		</DropdownMenu.Trigger>
		<DropdownMenu.Content align="end" class="min-w-40">
			{#each visible as action (action.label)}
				<DropdownMenu.Item
					variant={action.variant}
					disabled={action.disabled}
					onSelect={() => action.onSelect()}
				>
					{#if action.icon}<action.icon />{/if}
					{action.label}
				</DropdownMenu.Item>
			{/each}
		</DropdownMenu.Content>
	</DropdownMenu.Root>
{/if}
