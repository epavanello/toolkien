<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { brand } from '#lib/brand.ts';
	import { formatDateTime } from '#lib/core/format.ts';

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
		/** Last update, shown under the title */
		updated?: string;
		children: Snippet;
	};

	let { title, description, updated, children }: Props = $props();
</script>

<svelte:head>
	<title>{title} · {brand.name}</title>
	{#if description}<meta name="description" content={description} />{/if}
	<meta property="og:title" content={title} />
	{#if description}<meta property="og:description" content={description} />{/if}
</svelte:head>

<div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6">
	<a
		href={resolve('/(marketing)')}
		class="inline-flex w-fit items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
	>
		<ChevronLeft class="size-4" />{brand.name}
	</a>
	<article
		class="prose max-w-none prose-neutral dark:prose-invert prose-headings:scroll-mt-16 prose-headings:font-semibold prose-headings:tracking-tight prose-h1:text-2xl prose-h2:text-lg prose-h3:text-base prose-a:text-primary prose-code:mono prose-code:before:content-none prose-code:after:content-none"
	>
		<header class="not-prose mb-8 flex flex-col gap-1 border-b pb-4">
			<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
			{#if description}<p class="text-muted-foreground">{description}</p>{/if}
			{#if updated}<p class="text-xs text-muted-foreground">
					Last updated {formatDateTime(updated).slice(0, 10)}
				</p>{/if}
		</header>
		{@render children()}
	</article>
</div>
