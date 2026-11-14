<script lang="ts" generics="T extends Thing">
	import type { Thing, WithContext } from 'schema-dts';

	/** One JSON-LD block in `<head>`. `<` is escaped so no value can close the script tag early. */
	let { item }: { item: WithContext<T> } = $props();

	const json = $derived(JSON.stringify(item).replace(/</g, '\\u003c'));
	// Built from pieces so the parser never sees a closing script tag in the markup
	const tag = 'script';
	const html = $derived(`<${tag} type="application/ld+json">${json}</${tag}>`);
</script>

<svelte:head>
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- escaped JSON, data block (not executed) -->
	{@html html}
</svelte:head>
