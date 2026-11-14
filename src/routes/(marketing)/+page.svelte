<script lang="ts">
	import ArrowRight from '@lucide/svelte/icons/arrow-right';
	import Server from '@lucide/svelte/icons/server';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { brand } from '#lib/brand.ts';
	import { CodeBlock } from '#lib/components/app/index.ts';
	import { BrandArt, BrandImage } from '#lib/components/brand/index.ts';
	import {
		Compare,
		FeatureGrid,
		Hero,
		MarketingSection,
		PathCards,
		DirectoryShowcase,
		ProofStrip,
		Steps
	} from '#lib/components/marketing/index.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		connectOnce,
		description,
		example,
		paths,
		security,
		steps,
		teams,
		tokens,
		worksWith
	} from './landing.ts';
	import { LICENSE, REPO_URL } from './site.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const origin = $derived(page.url.origin);
	const signup = resolve('/(auth)/signup');
	const selfHosting = resolve('/(marketing)/docs/self-hosting');
</script>

<SeoHead
	title="{brand.name}: {brand.tagline}"
	exactTitle
	{description}
	jsonLd={[
		{
			'@context': 'https://schema.org',
			'@type': 'SoftwareApplication',
			name: brand.name,
			applicationCategory: 'DeveloperApplication',
			operatingSystem: 'Web',
			description,
			url: `${origin}/`,
			image: `${origin}/og.png`,
			offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
			license: `https://spdx.org/licenses/${LICENSE}.html`
		},
		{
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: brand.name,
			url: `${origin}/`,
			description,
			inLanguage: 'en'
		}
	]}
/>

<Hero
	eyebrow="The MCP gateway for AI agents"
	title={brand.tagline}
	description="Add your tools to Toolkien once and use them from every AI client. Your agent writes one script instead of forty tool calls: far fewer tokens, much faster runs."
>
	{#snippet actions()}
		<Button size="lg" icon={ArrowRight} iconAtEnd href={signup}>Start free</Button>
		<Button size="lg" variant="ghost" icon={Server} href={selfHosting}>Self-host it</Button>
	{/snippet}
	{#snippet note()}
		Free during early access · Open source under {LICENSE}
	{/snippet}
	{#snippet aside()}
		<BrandImage name="hero" class="w-full rounded-xl">
			{#snippet fallback()}<BrandArt name="converge" />{/snippet}
		</BrandImage>
	{/snippet}
</Hero>

<ProofStrip
	title="Works with"
	items={worksWith}
	note="Early access: your team could be the first logo here."
/>

<MarketingSection
	id="tokens"
	eyebrow="Code mode"
	title="Far fewer tokens. Much faster runs."
	description="Classic tool calling loads every schema and sends the whole context back to the model after each call. With Toolkien the agent reads only the types it needs and chains the calls in one script."
>
	<Compare before={tokens.before} after={tokens.after} note={tokens.note} />
</MarketingSection>

<MarketingSection
	id="how"
	tone="muted"
	eyebrow="How it works"
	title={brand.alternates[1]}
	description="Three tools do the work. The agent only loads what it needs, so long tool lists stop eating its context."
>
	<Steps items={steps} />
	<CodeBlock label="What your agent runs" code={example} />
</MarketingSection>

<MarketingSection
	id="everywhere"
	eyebrow="Connect once"
	title="Add a tool once. Use it from every client."
	description="Company and personal tools live in one place. Claude, ChatGPT, Codex, Cursor and VS Code all reach them through one connection, in parallel, and a new tool shows up in all of them."
>
	<BrandImage name="connect-once" class="mx-auto w-full max-w-4xl rounded-xl">
		{#snippet fallback()}{/snippet}
	</BrandImage>
	<Compare before={connectOnce.before} after={connectOnce.after} note={connectOnce.note} />
</MarketingSection>

<MarketingSection
	id="directory"
	tone="muted"
	eyebrow="Directory"
	title="Pick a tool. It's connected in a minute."
	description="Official remote MCP servers, ready to add: choose one, sign in, and every AI client you use can reach it."
>
	<DirectoryShowcase servers={data.directory.servers} total={data.directory.total} />
</MarketingSection>

<MarketingSection
	id="teams"
	tone="muted"
	eyebrow="For teams"
	title="Share company tools, not tokens"
	description="A company workspace gives colleagues the same tools, under the rules you set, with every call on the record."
>
	<BrandImage name="team-hall" class="w-full rounded-xl">
		{#snippet fallback()}{/snippet}
	</BrandImage>
	<FeatureGrid items={teams} columns={2} />
</MarketingSection>

<MarketingSection
	id="security"
	eyebrow="Security"
	title="Built to be trusted with your keys"
	description="Toolkien sits between your agent and your services. It keeps only what it needs: accounts, encrypted credentials, configuration and metadata logs."
>
	<FeatureGrid items={security} />
	<div>
		<Button variant="outline" href={resolve('/(marketing)/docs/security')}
			>How Toolkien is secured</Button
		>
	</div>
</MarketingSection>

<MarketingSection
	id="self-host"
	tone="muted"
	eyebrow="Managed or self-hosted"
	title="Ours to run, or yours"
	description="The managed service is the easy path. Self-hosting gives you the same product on your own server."
>
	<PathCards items={paths}>
		{#snippet actions(item)}
			{#if item.featured}
				<Button icon={ArrowRight} iconAtEnd href={signup}>Start free</Button>
			{:else}
				<Button variant="outline" href={selfHosting}>Self-hosting guide</Button>
				<Button variant="ghost" href={REPO_URL} target="_blank" rel="noopener">Source code</Button>
			{/if}
		{/snippet}
	</PathCards>
</MarketingSection>

<MarketingSection
	tone="ink"
	align="center"
	title={brand.alternates[0]}
	description="One connection per client. Switch workspaces when you ask to, and always see where your agent is operating."
>
	<BrandImage name="forge-mood" class="mx-auto w-full max-w-3xl rounded-xl">
		{#snippet fallback()}<BrandArt name="gate" />{/snippet}
	</BrandImage>
	<div class="flex flex-wrap justify-center gap-2">
		<Button size="lg" icon={ArrowRight} iconAtEnd href={signup}>Create a free account</Button>
		<Button size="lg" variant="ghost" href={resolve('/(marketing)/docs')}>Read the docs</Button>
	</div>
</MarketingSection>
