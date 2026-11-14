<script lang="ts">
	import type { Snippet } from 'svelte';
	import { brand } from '#lib/brand.ts';

	/** Title and one line (with links) at the top of an auth card */
	let { title, children }: { title: string; children?: Snippet } = $props();
</script>

<svelte:head><title>{title} · {brand.name}</title></svelte:head>

<div class="mb-5 flex flex-col gap-1">
	<h1 class="text-lg font-semibold">{title}</h1>
	{#if children}
		<p
			class="text-sm text-muted-foreground [&_a]:text-primary [&_a]:underline-offset-4 [&_a]:hover:underline"
		>
			{@render children()}
		</p>
	{/if}
</div>
