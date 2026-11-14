<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import type { Snippet } from 'svelte';
	import { remoteErrorMessage } from '#lib/core/remote-errors.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
	import EmptyState from './empty-state.svelte';

	/** Loading and error states around content that awaits remote queries */
	let { children }: { children: Snippet } = $props();
</script>

<svelte:boundary>
	{@render children()}

	{#snippet pending()}
		<div class="flex min-h-[30vh] items-center justify-center"><Spinner /></div>
	{/snippet}

	{#snippet failed(error, reset)}
		<EmptyState variant="page" icon={CircleAlert} title={remoteErrorMessage(error)}>
			{#snippet action()}<Button variant="outline" size="sm" onclick={reset}>Retry</Button
				>{/snippet}
		</EmptyState>
	{/snippet}
</svelte:boundary>
