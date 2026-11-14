<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A row of controls: `children` on the left (filters, search), `end` on the right (actions) */
	let { children, end }: { children?: Snippet; end?: Snippet } = $props();
</script>

<div class="flex flex-wrap items-center gap-2" role="toolbar" data-slot="toolbar">
	{#if children}{@render children()}{/if}
	{#if end}<div class="ml-auto flex items-center gap-2">{@render end()}</div>{/if}
</div>
