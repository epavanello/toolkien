<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Logo from '#lib/components/brand/logo.svelte';

	/**
	 * Frame for single-task pages outside a workspace (approval links, invitations, errors): the
	 * logo on top, the page below on the forge-grid floor. Compose with `Page variant="narrow"`.
	 */
	let { children }: { children: Snippet } = $props();
</script>

<div class="flex min-h-svh flex-col bg-muted/40 bg-forge-grid" data-slot="focus-frame">
	<header class="flex h-12 items-center border-b bg-background px-4">
		<a href={resolve('/(marketing)')} class="rounded-sm" aria-label="Toolkien home">
			<Logo size="sm" label="" />
		</a>
	</header>
	<main id="main" class="flex flex-1 flex-col">{@render children()}</main>
</div>
