<script lang="ts">
	import type { Snippet } from 'svelte';

	/** Landing hero: small eyebrow, headline, one paragraph, actions; optional aside (code sample) */
	type Props = {
		eyebrow?: string;
		title: string;
		description: string;
		actions?: Snippet;
		aside?: Snippet;
	};

	let { eyebrow, title, description, actions, aside }: Props = $props();
</script>

<section class="border-b" data-slot="hero">
	<div
		class="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24"
	>
		<div class="flex flex-col gap-5">
			{#if eyebrow}<p class="text-sm font-medium text-primary">{eyebrow}</p>{/if}
			<h1 class="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h1>
			<p class="max-w-xl text-lg text-pretty text-muted-foreground">{description}</p>
			{#if actions}<div class="flex flex-wrap gap-2">{@render actions()}</div>{/if}
		</div>
		{#if aside}<div class="min-w-0">{@render aside()}</div>{/if}
	</div>
</section>
