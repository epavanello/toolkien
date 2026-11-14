<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';

	/**
	 * Secondary content folded away (manual setup, advanced options). Native `<details>`, so it
	 * works without JavaScript and is keyboard accessible.
	 */
	type Props = { title: string; description?: string; open?: boolean; children: Snippet };

	let { title, description, open = false, children }: Props = $props();
</script>

<details class="group rounded-lg border bg-card" {open} data-slot="disclosure">
	<summary
		class="flex cursor-pointer list-none items-center gap-2 rounded-lg px-4 py-2.5 text-sm outline-none select-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden"
	>
		<ChevronRight
			class="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90"
			aria-hidden="true"
		/>
		<span class="shrink-0 font-medium">{title}</span>
		{#if description}
			<span class="hidden truncate text-muted-foreground sm:inline">{description}</span>
		{/if}
	</summary>
	<div class="flex flex-col gap-3 border-t px-4 py-3">{@render children()}</div>
</details>
