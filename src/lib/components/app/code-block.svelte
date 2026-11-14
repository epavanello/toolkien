<script lang="ts">
	import CopyButton from './copy-button.svelte';

	/** Multi-line code (TypeScript signatures, `.d.ts`, config snippets) with a copy button */
	type Props = { code: string; label?: string };

	let { code, label }: Props = $props();
</script>

<figure class="relative overflow-hidden rounded-md border bg-muted/40">
	{#if label}
		<figcaption class="border-b px-3 py-1.5 text-xs text-muted-foreground">{label}</figcaption>
	{/if}
	<div class="absolute top-1 right-1"><CopyButton value={code} label="Copy code" /></div>
	<pre class="overflow-x-auto p-3 pr-10 mono leading-relaxed"><code>{code}</code></pre>
</figure>
