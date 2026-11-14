<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Callout, DirectoryBrowser, EmptyState } from '#lib/components/app/index.ts';
	import { MarketingPage } from '#lib/components/marketing/index.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { requestServerUrl } from '../../w/[workspace]/directory/directory.ts';
	import { directoryJsonLd } from './seo.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const addHref = (id: string) => resolve('/(marketing)/directory/[id]/add', { id });
	const title = 'MCP server directory';
	const description = $derived(
		`${data.servers.length} remote MCP servers your AI agents can use through Toolkien: GitHub, Linear, Notion, Stripe, Sentry and more. Pick one, sign in, done.`
	);
</script>

<SeoHead
	{title}
	{description}
	jsonLd={[directoryJsonLd(page.url.origin, title, description, data.servers)]}
/>

{#snippet noResults(search: string)}
	<EmptyState
		title={search ? `No tool matches "${search}"` : 'No tool in this category'}
		description="Tell us which one you need: the directory grows with requests and pull requests."
	>
		{#snippet action()}
			<Button
				size="sm"
				icon={ExternalLink}
				href={requestServerUrl(search)}
				target="_blank"
				rel="noopener">Request a server</Button
			>
		{/snippet}
	</EmptyState>
{/snippet}

<MarketingPage
	eyebrow="Directory"
	title="Connect your AI agents to the tools you already use"
	description={`${data.servers.length} remote MCP servers, checked and preconfigured. Add one to Toolkien, sign in once, and every agent you connect can use it.`}
>
	<DirectoryBrowser entries={data.servers} label="Tools" {noResults}>
		{#snippet cardAction(server)}
			<Button
				size="sm"
				variant="outline"
				href={addHref(server.id)}
				aria-label={`Add ${server.name} to Toolkien`}>Add</Button
			>
		{/snippet}
		{#snippet panelAction(server)}
			<Button href={addHref(server.id)} icon={ArrowRight} iconAtEnd>Add to Toolkien</Button>
		{/snippet}
	</DirectoryBrowser>

	<Callout
		title="Missing a tool?"
		description="Request it, or add it yourself: the directory is open source and grows through pull requests."
	>
		{#snippet action()}
			<Button
				size="sm"
				variant="outline"
				icon={ExternalLink}
				href={requestServerUrl('')}
				target="_blank"
				rel="noopener">Request a server</Button
			>
		{/snippet}
	</Callout>
</MarketingPage>
