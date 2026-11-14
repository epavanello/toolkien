<script lang="ts">
	import { resolve } from '$app/paths';
	import { brand } from '#lib/brand.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<div class="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10">
	<a href={resolve('/(marketing)')} class="text-lg font-semibold tracking-tight">{brand.name}</a>
	<main class="w-full max-w-sm rounded-lg border bg-card p-6 shadow-xs">{@render children()}</main>
	<p class="text-xs text-muted-foreground">{brand.tagline}</p>
</div>
