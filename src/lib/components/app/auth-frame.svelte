<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import type { Snippet } from 'svelte';
	import BrandArt from '#lib/components/brand/brand-art.svelte';
	import Logo from '#lib/components/brand/logo.svelte';

	/**
	 * Sign-in, sign-up and consent frame: the card on the forge-grid floor and, from `lg`, an ink
	 * brand panel (tagline, the converge illustration, three trust points). The card is the task;
	 * the panel is the only decoration and is hidden from assistive tech.
	 */
	type Props = {
		/** Where the logo links (the landing) */
		home: string;
		tagline: string;
		children: Snippet;
	};

	let { home, tagline, children }: Props = $props();

	const points = [
		'Upstream tokens sealed with a per-workspace key',
		'Scripts run in a sandbox with no network',
		'Writes wait for your approval'
	];
</script>

<div class="grid min-h-svh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]" data-slot="auth-frame">
	<div class="flex flex-col items-center justify-center gap-6 bg-muted/40 bg-forge-grid px-4 py-10">
		<a href={home} class="rounded-sm" aria-label="Toolkien home"><Logo size="lg" label="" /></a>
		<main class="w-full max-w-sm rounded-lg border bg-card p-6 shadow-plate">
			{@render children()}
		</main>
		<p class="font-display text-sm text-muted-foreground italic lg:hidden">{tagline}</p>
	</div>
	<aside
		class="dark relative hidden flex-col justify-between gap-10 overflow-hidden bg-ink p-12 text-foreground lg:flex"
		aria-hidden="true"
	>
		<p class="max-w-md font-display text-4xl leading-tight font-semibold text-balance">
			{tagline}
		</p>
		<BrandArt name="converge" class="max-w-lg" />
		<ul class="flex flex-col gap-2 text-sm text-muted-foreground">
			{#each points as point (point)}
				<li class="flex items-center gap-2">
					<Check class="size-4 text-primary" />{point}
				</li>
			{/each}
		</ul>
	</aside>
</div>
