<script lang="ts">
	import type { PreviewValue } from '#lib/server/bridge/content.ts';
	import CopyButton from './copy-button.svelte';

	/**
	 * The arguments of a tool call waiting for approval, laid out for reading: one row per field,
	 * objects as indented sub-fields, long text and URLs wrapping, arrays and deeper values as
	 * indented JSON. Plain text only: nothing here is a link or HTML.
	 */
	type Props = { value: PreviewValue; label?: string };

	let { value, label = 'Arguments' }: Props = $props();

	/** Back to a plain value, for the copy button */
	function plain(v: PreviewValue): unknown {
		if (v.kind === 'text') return v.text;
		if (v.kind === 'fields')
			return Object.fromEntries(v.fields.map((f) => [f.key, plain(f.value)]));
		try {
			return JSON.parse(v.text);
		} catch {
			return v.text;
		}
	}

	const copyText = $derived(
		value.kind === 'text' ? value.text : JSON.stringify(plain(value), null, 2)
	);
</script>

{#snippet render(v: PreviewValue)}
	{#if v.kind === 'fields'}
		<dl
			class="grid grid-cols-1 gap-x-4 gap-y-3 @sm:grid-cols-[minmax(6rem,max-content)_minmax(0,1fr)]"
		>
			{#each v.fields as field, i (i)}
				<dt class="font-mono text-xs leading-6 [overflow-wrap:anywhere] text-muted-foreground">
					{field.key}
				</dt>
				<dd class="-mt-2 min-w-0 @sm:mt-0">
					{#if field.value.kind === 'fields'}
						<div class="border-l-2 pl-3 @sm:mt-1">{@render render(field.value)}</div>
					{:else}
						{@render render(field.value)}
					{/if}
				</dd>
			{/each}
			{#if v.fields.length === 0}
				<dd class="text-muted-foreground @sm:col-span-2">(empty object)</dd>
			{/if}
		</dl>
		{#if v.more > 0}
			<p class="mt-2 text-xs text-muted-foreground">… {v.more} more fields</p>
		{/if}
	{:else if v.kind === 'json'}
		<pre
			class="rounded bg-background/60 px-2 py-1 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap">{v.text}</pre>
	{:else if v.text === ''}
		<span class="text-muted-foreground">(empty)</span>
	{:else}
		<p class="text-sm leading-6 [overflow-wrap:anywhere] whitespace-pre-wrap">{v.text}</p>
	{/if}
{/snippet}

<figure class="@container relative overflow-hidden rounded-md border bg-muted/40">
	<figcaption class="border-b px-3 py-1.5 text-xs text-muted-foreground">{label}</figcaption>
	<div class="absolute top-0.5 right-1 z-10">
		<CopyButton value={copyText} label="Copy arguments" />
	</div>
	<div class="px-3 py-3">{@render render(value)}</div>
</figure>
