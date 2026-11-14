<script lang="ts">
	import Activity from '@lucide/svelte/icons/activity';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import LibraryBig from '@lucide/svelte/icons/library-big';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import { resolve } from '$app/paths';
	import { matchClient, samplePrompts, type ClientGuide } from '#lib/core/mcp-clients.ts';
	import type { OnboardingStatus } from '#lib/server/clients/types.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import Callout from './callout.svelte';
	import ChoiceGrid, { type ChoiceItem } from './choice-grid.svelte';
	import CodeBlock from './code-block.svelte';
	import CommandField from './command-field.svelte';
	import Disclosure from './disclosure.svelte';
	import InlineText from './inline-text.svelte';
	import Mono from './mono.svelte';
	import RelativeTime from './relative-time.svelte';
	import ServiceLogo from './service-logo.svelte';
	import Steps, { type StepItem } from './steps.svelte';

	/**
	 * The guided setup of one MCP client: install (fastest method first), sign in (what the user
	 * will see, with the live connection state), try a prompt (done as soon as the first MCP call
	 * of this user reaches Toolkien, then next steps); then plan notes and the manual config. All
	 * texts and commands come from the client catalog (`#lib/core/mcp-clients.ts`).
	 */
	type Props = { guide: ClientGuide; status: OnboardingStatus; workspace: string };

	let { guide, status, workspace }: Props = $props();

	const install = $derived(guide.install);
	const connected = $derived(
		status.clients.find((client) => (matchClient(client.name) ?? 'other') === guide.id) ?? null
	);
	const others = $derived(status.clients.filter((client) => client !== connected));
	const prompts = $derived(samplePrompts(status.connectors));
	const firstCall = $derived(status.firstCall);

	const nextSteps: (ChoiceItem & { href: string })[] = $derived([
		{
			value: 'activity',
			label: 'Open Activity',
			description: 'Every call your agents make',
			icon: Activity,
			href: resolve('/w/[workspace]/activity', { workspace })
		},
		{
			value: 'permissions',
			label: 'Set permissions',
			description: 'Allow, ask or block each tool',
			icon: ShieldCheck,
			href: resolve('/w/[workspace]/permissions', { workspace })
		},
		{
			value: 'directory',
			label: 'Add more servers',
			description: 'From the directory or by URL',
			icon: LibraryBig,
			href: resolve('/w/[workspace]/directory', { workspace })
		}
	]);
	const installTitle = $derived(
		install.kind === 'command'
			? 'Run this in your terminal'
			: install.kind === 'link'
				? `Add Toolkien to ${guide.name}`
				: `Add Toolkien in ${guide.name}`
	);

	const steps: StepItem[] = $derived([
		{ title: installTitle, status: connected ? 'done' : 'current', content: installStep },
		{
			title: 'Sign in',
			description: 'Toolkien asks you once to approve the client and pick a workspace.',
			status: connected ? 'done' : 'todo',
			content: signInStep
		},
		{
			id: 'try',
			title: 'Try it',
			description: firstCall
				? 'Toolkien answered your agent. What next?'
				: `Paste one of these in ${guide.name}. This step ticks by itself on the first call.`,
			status: firstCall ? 'done' : connected ? 'current' : 'todo',
			content: tryStep
		}
	]);
</script>

{#snippet installStep()}
	{#if install.kind === 'command'}
		<CommandField value={install.command} />
	{:else if install.kind === 'link'}
		<div class="flex flex-wrap items-center gap-2">
			<Button size="lg" href={install.href}>{install.label}</Button>
			{#each install.alternates ?? [] as alternate (alternate.href)}
				<Button variant="ghost" size="sm" href={alternate.href}>{alternate.label}</Button>
			{/each}
		</div>
		<p class="text-sm text-muted-foreground">
			{guide.name} opens and asks you to confirm. Nothing happens? Use the manual setup below.
		</p>
	{:else}
		{#if install.settings}
			<Button
				class="w-fit"
				variant="outline"
				href={install.settings.href}
				target="_blank"
				rel="noopener noreferrer"
				icon={ExternalLink}
				iconAtEnd
			>
				{install.settings.label}
			</Button>
		{/if}
		<Steps variant="list" items={install.steps.map((title) => ({ title }))} />
		<CommandField variant="value" label="Server URL" value={status.mcpUrl} />
	{/if}
{/snippet}

{#snippet signInStep()}
	{#if guide.signIn.command}
		<CommandField
			variant={guide.signIn.command.startsWith('/') ? 'value' : 'command'}
			value={guide.signIn.command}
		/>
	{/if}
	<Steps variant="list" items={guide.signIn.steps.map((title) => ({ title }))} />
	{#if connected}
		<Callout
			tone="success"
			title="Connected: {connected.name}"
			time={connected.lastUsedAt
				? { label: 'last used', value: connected.lastUsedAt }
				: { label: 'signed in', value: connected.connectedAt }}
		/>
	{:else}
		<Callout
			tone="pending"
			title="Waiting for {guide.name} to sign in…"
			description={others.length > 0
				? `This page updates by itself. Already connected: ${others.map((c) => c.name).join(', ')}.`
				: 'This page updates by itself once you click Allow access.'}
		/>
	{/if}
{/snippet}

{#snippet promptList()}
	{#each prompts as prompt (prompt)}
		<CommandField variant="prompt" value={prompt} />
	{/each}
{/snippet}

{#snippet tryStep()}
	{#if firstCall}
		<Callout tone="success" title="Your first call arrived">
			<p class="text-pretty text-muted-foreground">
				<Mono value={firstCall.tool} variant="path" /> via {firstCall.clientName ??
					'your AI client'}, <RelativeTime value={firstCall.at} />.
			</p>
		</Callout>
		<ChoiceGrid
			label="Next steps"
			groups={[{ items: nextSteps }]}
			href={(value) => nextSteps.find((step) => step.value === value)!.href}
			replaceState={false}
		/>
		<Disclosure title="More prompts to try">{@render promptList()}</Disclosure>
	{:else}
		{#if status.servers.length === 0}
			<Callout title="Add a server first" description="Prompts need at least one connected server.">
				{#snippet action()}
					<Button
						size="sm"
						variant="outline"
						icon={LibraryBig}
						href={resolve('/w/[workspace]/directory', { workspace })}>Open directory</Button
					>
				{/snippet}
			</Callout>
		{:else}
			<ul class="flex flex-wrap gap-x-4 gap-y-1.5 text-sm" aria-label="Your servers">
				{#each status.servers as server (server.name)}
					<li><ServiceLogo name={server.name} src={server.icon} size="xs" withName /></li>
				{/each}
			</ul>
		{/if}
		{@render promptList()}
	{/if}
{/snippet}

<div class="flex flex-col gap-6" data-slot="client-setup">
	<Steps items={steps} label="Connect {guide.name}" />

	{#if guide.notes.length > 0}
		<div class="flex flex-col gap-3">
			{#each guide.notes as note (note.title)}
				<Callout tone={note.tone} title={note.title}>
					<p class="text-pretty text-muted-foreground"><InlineText text={note.description} /></p>
				</Callout>
			{/each}
		</div>
	{/if}

	<Disclosure title="Manual setup" description="config files and the raw URL">
		<CommandField
			variant="value"
			label="Server URL (Streamable HTTP, OAuth)"
			value={status.mcpUrl}
		/>
		{#each guide.manual as manual (manual.label)}
			<CodeBlock label={manual.label} lang={manual.lang} code={manual.code} />
		{/each}
	</Disclosure>
</div>
