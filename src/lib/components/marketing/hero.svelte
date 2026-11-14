<script lang="ts">
	import type { Snippet } from 'svelte';
	import Hallmark from './hallmark.svelte';

	/**
	 * Landing hero on the forge-grid floor: hallmark eyebrow, display headline, one paragraph,
	 * actions, a small note under them (trust line); optional aside (the converge illustration).
	 */
	type Props = {
		eyebrow?: string;
		title: string;
		description: string;
		actions?: Snippet;
		/** One line under the actions: free tier, license, compatibility */
		note?: Snippet;
		aside?: Snippet;
	};

	let { eyebrow, title, description, actions, note, aside }: Props = $props();
</script>

<section class="relative overflow-hidden border-b bg-forge-grid" data-slot="hero">
	<!-- The forge glow: one soft ember light behind the illustration -->
	<div
		class="pointer-events-none absolute -top-40 right-[-10%] size-[42rem] rounded-full bg-ember/10 blur-3xl"
		aria-hidden="true"
	></div>
	<div
		class="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-24"
	>
		<div class="flex flex-col gap-6">
			{#if eyebrow}<Hallmark>{eyebrow}</Hallmark>{/if}
			<h1
				class="font-display text-5xl leading-[1.02] font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl"
			>
				{title}
			</h1>
			<p class="max-w-xl text-lg text-pretty text-muted-foreground">{description}</p>
			{#if actions}<div class="flex flex-wrap gap-2">{@render actions()}</div>{/if}
			{#if note}<p class="text-sm text-muted-foreground">{@render note()}</p>{/if}
		</div>
		{#if aside}<div class="min-w-0">{@render aside()}</div>{/if}
	</div>
</section>
