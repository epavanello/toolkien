<script lang="ts">
	import type { Thing, WithContext } from 'schema-dts';
	import { page } from '$app/state';
	import { brand } from '#lib/brand.ts';
	import JsonLd from './json-ld.svelte';

	/** Rendered by `scripts/brand-images.ts` */
	const DEFAULT_IMAGE = '/og.png';

	/**
	 * Every public page's head: title, description, canonical URL, Open Graph, Twitter card,
	 * robots and optional JSON-LD (`schema-dts` types). App pages pass `noindex`.
	 */
	type Props = {
		/** Page title; the brand is appended (`Docs · Toolkien`) unless `exactTitle` */
		title: string;
		description?: string;
		exactTitle?: boolean;
		/** Path or absolute URL; default: the current path without query or hash */
		canonical?: string;
		/** Absolute or root-relative image (1200×630); default: the brand card `static/og.png` */
		image?: string;
		imageAlt?: string;
		type?: 'website' | 'article';
		noindex?: boolean;
		/** `YYYY-MM-DD`, for articles (docs, legal) */
		modified?: string;
		jsonLd?: WithContext<Thing>[];
	};

	let {
		title,
		description,
		exactTitle = false,
		canonical,
		image = DEFAULT_IMAGE,
		imageAlt = `${brand.name}: ${brand.tagline}`,
		type = 'website',
		noindex = false,
		modified,
		jsonLd = []
	}: Props = $props();

	const origin = $derived(page.url.origin);
	const absolute = (value: string) => (/^https?:\/\//.test(value) ? value : `${origin}${value}`);
	const fullTitle = $derived(exactTitle ? title : `${title} · ${brand.name}`);
	const url = $derived(
		absolute(canonical ?? (page.url.pathname === '/' ? '/' : page.url.pathname))
	);
</script>

<svelte:head>
	<title>{fullTitle}</title>
	{#if description}<meta name="description" content={description} />{/if}
	<meta
		name="robots"
		content={noindex
			? 'noindex, nofollow'
			: 'index, follow, max-image-preview:large, max-snippet:-1'}
	/>
	{#if !noindex}
		<link rel="canonical" href={url} />
		<meta property="og:type" content={type} />
		<meta property="og:url" content={url} />
		<meta property="og:site_name" content={brand.name} />
		<meta property="og:locale" content="en_US" />
		<meta property="og:title" content={fullTitle} />
		{#if description}<meta property="og:description" content={description} />{/if}
		<meta property="og:image" content={absolute(image)} />
		<meta property="og:image:alt" content={imageAlt} />
		{#if image === DEFAULT_IMAGE}
			<meta property="og:image:type" content="image/png" />
			<meta property="og:image:width" content="1200" />
			<meta property="og:image:height" content="630" />
		{/if}
		{#if modified}<meta property="article:modified_time" content={modified} />{/if}
		<meta name="twitter:card" content="summary_large_image" />
		<meta name="twitter:title" content={fullTitle} />
		{#if description}<meta name="twitter:description" content={description} />{/if}
		<meta name="twitter:image" content={absolute(image)} />
		<meta name="twitter:image:alt" content={imageAlt} />
	{/if}
</svelte:head>

{#if !noindex}
	{#each jsonLd as item, index (index)}
		<JsonLd {item} />
	{/each}
{/if}
