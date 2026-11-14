<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { brand } from '#lib/brand.ts';

	/**
	 * Frame for single-task pages outside a workspace (approval links, invitations): the brand
	 * on top, the page below. Compose with `Page variant="narrow"`.
	 */
	let { children }: { children: Snippet } = $props();
</script>

<div class="flex min-h-svh flex-col bg-muted/40" data-slot="focus-frame">
	<header class="flex h-12 items-center border-b bg-background px-4">
		<a href={resolve('/(marketing)')} class="text-sm font-semibold tracking-tight">{brand.name}</a>
	</header>
	<main id="main" class="flex flex-1 flex-col">{@render children()}</main>
</div>
