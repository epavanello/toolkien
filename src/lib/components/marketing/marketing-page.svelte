<script lang="ts">
	import type { Snippet } from 'svelte';
	import Hallmark from './hallmark.svelte';

	/**
	 * A public page that is a tool rather than an article (the server directory): hallmark
	 * eyebrow, the page's `h1`, one paragraph, optional actions, then the content in the site's
	 * width.
	 */
	type Props = {
		eyebrow?: string;
		title: string;
		description?: string;
		actions?: Snippet;
		children: Snippet;
	};

	let { eyebrow, title, description, actions, children }: Props = $props();
</script>

<header class="border-b bg-forge-grid" data-slot="marketing-page">
	<div class="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-12 sm:px-6 lg:py-16">
		{#if eyebrow}<Hallmark>{eyebrow}</Hallmark>{/if}
		<h1
			class="max-w-3xl font-display text-4xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl"
		>
			{title}
		</h1>
		{#if description}
			<p class="max-w-2xl text-lg text-pretty text-muted-foreground">{description}</p>
		{/if}
		{#if actions}<div class="flex flex-wrap gap-2">{@render actions()}</div>{/if}
	</div>
</header>
<div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6">
	{@render children()}
</div>
