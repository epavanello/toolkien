<script lang="ts">
	import { highlightCode } from '#lib/functions/highlight.remote.ts';
	import type { HighlightLang } from '#lib/server/highlight.ts';
	import CopyButton from './copy-button.svelte';

	/**
	 * Multi-line code (TypeScript signatures, `.d.ts`, config snippets) with a copy button.
	 * Highlighted on the server (Shiki, light/dark through CSS variables); plain while loading or
	 * if highlighting fails. `lang: 'text'` for content that is not code (argument previews).
	 */
	type Props = { code: string; label?: string; lang?: HighlightLang };

	let { code, label, lang = 'ts' }: Props = $props();
</script>

{#snippet plain()}
	<pre class="shiki"><code>{code}</code></pre>
{/snippet}

<figure class="code-block relative overflow-hidden rounded-md border bg-muted/40">
	{#if label}
		<figcaption class="border-b px-3 py-1.5 text-xs text-muted-foreground">{label}</figcaption>
	{/if}
	<div class="absolute top-1 right-1 z-10"><CopyButton value={code} label="Copy code" /></div>
	{#if lang === 'text'}
		{@render plain()}
	{:else}
		<svelte:boundary>
			<!-- Shiki escapes the code; the HTML only adds spans with color variables -->
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html await highlightCode({ code, lang })}
			{#snippet failed()}{@render plain()}{/snippet}
		</svelte:boundary>
	{/if}
</figure>
