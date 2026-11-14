<script lang="ts" module>
	/**
	 * Generated brand illustrations, dropped in `src/lib/assets/brand/<name>.webp` (prompts in
	 * docs/brand.md → Image prompts). Picked up at build time: until a file exists, the fallback
	 * (an SVG drawing) renders instead, so pages never show a broken image.
	 */
	const FILES = import.meta.glob<string>('../../assets/brand/*.{webp,png,jpg}', {
		eager: true,
		query: '?url',
		import: 'default'
	});

	/** Expected names: `hero`, `forge-mood`, `connect-once`, `team-hall` (see docs/brand.md) */
	export type BrandImageName = 'hero' | 'forge-mood' | 'connect-once' | 'team-hall';

	export const brandImageUrl = (name: BrandImageName): string | undefined =>
		Object.entries(FILES).find(([path]) => path.split('/').pop()?.split('.')[0] === name)?.[1];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * A generated illustration with a drawn fallback. Decorative (`alt=""`) unless `alt` is given.
	 */
	type Props = { name: BrandImageName; alt?: string; class?: string; fallback: Snippet };

	let { name, alt = '', class: className, fallback }: Props = $props();

	const src = $derived(brandImageUrl(name));
</script>

{#if src}
	<img {src} {alt} class={className} loading="lazy" decoding="async" data-slot="brand-image" />
{:else}
	{@render fallback()}
{/if}
