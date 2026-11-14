<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import FileClock from '@lucide/svelte/icons/file-clock';
	import Globe from '@lucide/svelte/icons/globe';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import ListChecks from '@lucide/svelte/icons/list-checks';
	import Lock from '@lucide/svelte/icons/lock';
	import Network from '@lucide/svelte/icons/network';
	import Power from '@lucide/svelte/icons/power';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import SquareTerminal from '@lucide/svelte/icons/square-terminal';
	import Users from '@lucide/svelte/icons/users';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { brand } from '#lib/brand.ts';
	import { CodeBlock } from '#lib/components/app/index.ts';
	import { FeatureGrid, Hero, MarketingSection, Steps } from '#lib/components/marketing/index.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { LICENSE, REPO_URL } from './site.ts';

	const description =
		'Toolkien is one remote MCP server for all of yours. Your agent searches tools, reads only the TypeScript types it needs and runs scripts in a sandbox, with permissions, approvals and encrypted credentials.';

	const example = `// The agent found these with tools_search, read their types with tools_describe,
// and runs them in one sandboxed script with execute.
const issues = await github.listIssues({ repo: 'acme/web', state: 'open' });
const urgent = issues.filter((issue) => issue.labels.includes('p0'));

await slack.postMessage({
  channel: '#triage',
  text: \`\${urgent.length} urgent issues today\`
}); // "ask" permission: you approve this call first`;

	const steps = [
		{
			title: 'Search',
			description:
				'The agent looks for tools by text in your active workspace and gets paths with a one-line summary, not hundreds of schemas.',
			code: 'tools_search'
		},
		{
			title: 'Describe',
			description:
				'It reads the TypeScript declarations of the few tools it needs, generated from each server’s schemas.',
			code: 'tools_describe'
		},
		{
			title: 'Execute',
			description:
				'It runs one script in an isolated Deno sandbox. Every call goes through permissions; writes can wait for your approval.',
			code: 'execute'
		}
	];

	const security = [
		{
			icon: Lock,
			title: 'Encrypted credentials',
			description:
				'Upstream tokens are sealed with AES-256-GCM and a per-workspace key wrapped by OpenBao. A stolen database reveals no token.'
		},
		{
			icon: SquareTerminal,
			title: 'Sandboxed scripts',
			description:
				'A fresh Deno process with no permissions per execution: no network, no environment, no filesystem. Only the tools you allowed.'
		},
		{
			icon: ListChecks,
			title: 'Permissions and approvals',
			description:
				'Allow, ask or block per tool. Writes ask by default and approvals come only from you, never from the model.'
		},
		{
			icon: KeyRound,
			title: 'No token passthrough',
			description:
				'The token your client holds is never forwarded upstream. OAuth 2.1 with PKCE, audience-bound short-lived tokens.'
		},
		{
			icon: Network,
			title: 'Egress control',
			description:
				'Upstream calls leave through a dedicated proxy, https only, with private and metadata addresses blocked.'
		},
		{
			icon: FileClock,
			title: 'Metadata-only logs',
			description:
				'Who did what and when, never arguments, results or script code. Kept 90 days, then deleted.'
		}
	];

	const teams = [
		{
			icon: Building2,
			title: 'Company workspaces',
			description:
				'Invite your team with a link. Admins connect shared accounts once; members use them without seeing a token.'
		},
		{
			icon: ShieldCheck,
			title: 'Admin policy',
			description:
				'Allowed servers, minimum permissions members cannot loosen, and whether personal connectors or free URLs are allowed.'
		},
		{
			icon: Users,
			title: 'Roles and activity',
			description:
				'Owner, admin, member. Everyone sees their own timeline; admins see all of it and export CSV.'
		},
		{
			icon: Power,
			title: 'Kill switch',
			description:
				'Stop a workspace in one click: running executions end, tokens are suspended, configuration stays.'
		}
	];

	const origin = $derived(page.url.origin);
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
			url: origin,
			offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
			license: `https://spdx.org/licenses/${LICENSE}.html`
		},
		{
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: brand.name,
			url: origin,
			description
		}
	]}
/>

<Hero
	eyebrow="Free during the early phase"
	title={brand.tagline}
	description="Connect one MCP server to Claude, Codex or Cursor and use every remote MCP server you configured. Your agent discovers tools on demand and writes code against typed functions, instead of drowning in tool schemas."
>
	{#snippet actions()}
		<Button size="lg" href={resolve('/(auth)/signup')}>Get started</Button>
		<Button size="lg" variant="outline" href={resolve('/(marketing)/docs/getting-started')}
			>Read the docs</Button
		>
	{/snippet}
	{#snippet aside()}
		<CodeBlock label="What your agent runs" code={example} />
	{/snippet}
</Hero>

<MarketingSection
	id="how"
	eyebrow="Code mode"
	title={brand.alternates[1]}
	description="Three tools do the work. The agent only loads what it needs, so long tool lists stop eating its context."
>
	<Steps items={steps} />
</MarketingSection>

<MarketingSection
	id="security"
	tone="muted"
	eyebrow="Security"
	title="Built to be trusted with your accounts"
	description="Toolkien sits between your agent and your services. It keeps only what it needs: accounts, encrypted credentials, configuration and metadata logs."
>
	<FeatureGrid items={security} />
	<div>
		<Button variant="outline" href={resolve('/(marketing)/docs/security')}
			>How Toolkien is secured</Button
		>
	</div>
</MarketingSection>

<MarketingSection id="teams" eyebrow="For teams" title="Shared connectors, without sharing tokens">
	<FeatureGrid items={teams} columns={2} />
</MarketingSection>

<MarketingSection
	id="self-host"
	tone="muted"
	eyebrow="Open source"
	title="Prefer to run it yourself?"
	description="Toolkien is open source under {LICENSE}. The managed service is the easy path; self-hosting gives you the same product on your own server: one Docker Compose stack (app, OpenBao, egress proxy, runner), ready for Coolify."
>
	<div class="flex flex-wrap gap-2">
		<Button variant="outline" icon={Globe} href={REPO_URL} target="_blank" rel="noopener"
			>Source code</Button
		>
		<Button variant="outline" href={resolve('/(marketing)/docs/self-hosting')}
			>Self-hosting guide</Button
		>
	</div>
</MarketingSection>

<MarketingSection
	title={brand.alternates[0]}
	description="One connection per client. Switch workspaces when you ask to, and always see where your agent is operating."
>
	<div class="flex flex-wrap gap-2">
		<Button href={resolve('/(auth)/signup')}>Create a free account</Button>
		<Button variant="ghost" href={resolve('/(marketing)/docs')}>Documentation</Button>
	</div>
</MarketingSection>
