<script lang="ts" module>
	import { getContext, setContext } from 'svelte';

	const EMBEDDED = Symbol('markdown-embedded');

	/**
	 * Called by a shell that already frames markdown pages (the docs sidebar layout): the layout
	 * then renders only the article, without its own container and back link.
	 */
	export const embedMarkdownPages = () => setContext(EMBEDDED, true);
</script>

<script lang="ts">
	// Hover popups of ```ts twoslash fences (CSS only, no client script)
	import '@shikijs/twoslash/style-rich.css';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import type { Snippet } from 'svelte';
	import type { BreadcrumbList, TechArticle, WebPage, WithContext } from 'schema-dts';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { brand } from '#lib/brand.ts';
	import { docsOgImage } from '#lib/components/seo/og.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';

	/**
	 * mdsvex layout of every `+page.md` (legal, docs, blog). Frontmatter keys arrive as props:
	 *
	 * ```md
	 * ---
	 * title: Privacy policy
	 * description: How Toolkien handles personal data.
	 * updated: 2026-11-14
	 * ---
	 * ```
	 * Pages contain only markdown: styling lives here (typography plugin, app tokens).
	 */
	type Props = {
		title: string;
		description?: string;
		/** Last update, shown under the title (YAML may parse it as a Date) */
		updated?: string | Date;
		children: Snippet;
	};

	let { title, description, updated, children }: Props = $props();

	const embedded = getContext<boolean>(EMBEDDED) ?? false;
	const updatedDay = $derived(updated ? new Date(updated).toISOString().slice(0, 10) : undefined);

	// Structured data: docs are TechArticles, other markdown pages (legal) plain WebPages, both
	// with a breadcrumb trail (Home › Documentation › Page) for search results and AI answers
	const origin = $derived(page.url.origin);
	const url = $derived(`${origin}${page.url.pathname}`);
	const isDocs = $derived(page.url.pathname.startsWith('/docs'));
	/** Docs pages have their own card (`scripts/brand-images.ts` → `static/og/docs/<slug>.png`) */
	const image = $derived(isDocs ? docsOgImage(page.url.pathname) : undefined);
	const pageLd = $derived<WithContext<TechArticle | WebPage>>({
		'@context': 'https://schema.org',
		'@type': isDocs ? 'TechArticle' : 'WebPage',
		...(isDocs ? { headline: title } : { name: title }),
		...(description ? { description } : {}),
		...(updatedDay ? { dateModified: updatedDay } : {}),
		url,
		inLanguage: 'en',
		image: `${origin}${image ?? '/og.png'}`,
		isPartOf: { '@type': 'WebSite', name: brand.name, url: `${origin}/` },
		publisher: { '@type': 'Organization', name: brand.name, url: `${origin}/` }
	});
	const breadcrumbs = $derived<WithContext<BreadcrumbList>>({
		'@context': 'https://schema.org',
		'@type': 'BreadcrumbList',
		itemListElement: [
			{ name: brand.name, url: `${origin}/` },
			...(isDocs && page.url.pathname !== '/docs'
				? [{ name: 'Documentation', url: `${origin}/docs` }]
				: []),
			{ name: title, url }
		].map((crumb, index) => ({
			'@type': 'ListItem',
			position: index + 1,
			name: crumb.name,
			item: crumb.url
		}))
	});
</script>

<SeoHead
	{title}
	{description}
	type="article"
	{image}
	modified={updatedDay}
	jsonLd={[pageLd, breadcrumbs]}
/>

{#snippet article()}
	<article
		class="prose max-w-none prose-neutral dark:prose-invert prose-headings:scroll-mt-16 prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-2xl prose-h2:text-lg prose-h3:text-base prose-a:text-primary prose-a:decoration-primary/40 prose-a:underline-offset-2 hover:prose-a:decoration-primary prose-blockquote:border-l-primary prose-blockquote:font-normal prose-blockquote:not-italic prose-code:mono prose-code:before:content-none prose-code:after:content-none"
	>
		<header class="not-prose mb-8 flex flex-col gap-1.5 border-b pb-5">
			<p class="mono text-xs font-medium tracking-wider text-primary uppercase">
				{isDocs ? 'Documentation' : 'Legal'}
			</p>
			<h1 class="font-display text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
				{title}
			</h1>
			{#if description}<p class="text-muted-foreground">{description}</p>{/if}
			{#if updatedDay}<p class="text-xs text-muted-foreground">Last updated {updatedDay}</p>{/if}
		</header>
		{@render children()}
	</article>
{/snippet}

{#if embedded}
	{@render article()}
{:else}
	<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
		<a
			href={resolve('/(marketing)')}
			class="inline-flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
		>
			<ChevronLeft class="size-4" />{brand.name}
		</a>
		{@render article()}
	</div>
{/if}
