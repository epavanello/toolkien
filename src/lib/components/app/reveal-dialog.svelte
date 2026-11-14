<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import CopyButton from './copy-button.svelte';

	/**
	 * Shows a value the server returns only once (invite link, one-time values) with a
	 * copy button and a warning that it will not be shown again.
	 */
	type Props = {
		open?: boolean;
		title: string;
		description?: string;
		/** One value per line; each gets its own copy button when `copyEach` */
		values: string[];
		copyEach?: boolean;
		children?: Snippet;
	};

	let {
		open = $bindable(false),
		title,
		description,
		values,
		copyEach = false,
		children
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>
				{description ?? 'Copy it now: it will not be shown again.'}
			</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-1 rounded-md border bg-muted/40 p-2">
			{#each values as value, index (index)}
				<div class="flex items-center gap-2">
					<code class="min-w-0 flex-1 mono text-xs break-all">{value}</code>
					{#if copyEach}<CopyButton {value} />{/if}
				</div>
			{/each}
		</div>
		{#if children}{@render children()}{/if}
		<Dialog.Footer>
			{#if !copyEach}<CopyButton value={values.join('\n')} label="Copy all" />{/if}
			<Button onclick={() => (open = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
