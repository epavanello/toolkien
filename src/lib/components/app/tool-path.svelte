<script lang="ts">
	import Mono from './mono.svelte';
	import UnverifiedBadge from './unverified-badge.svelte';

	/** A tool path (`github.createIssue`) with the "unverified" badge for free-URL connectors */
	type Props = { path: string; unverified?: boolean; copy?: boolean };

	let { path, unverified = false, copy = false }: Props = $props();
</script>

<span class="inline-flex min-w-0 items-center gap-2" data-slot="tool-path">
	<Mono value={path} variant="path" truncate {copy} />
	{#if unverified}<UnverifiedBadge />{/if}
</span>
