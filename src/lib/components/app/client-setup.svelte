<script lang="ts">
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import LibraryBig from '@lucide/svelte/icons/library-big';
	import { resolve } from '$app/paths';
	import { formatRelative } from '#lib/core/format.ts';
	import { matchClient, samplePrompts, type ClientGuide } from '#lib/core/mcp-clients.ts';
	import type { OnboardingStatus } from '#lib/server/clients/types.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import Callout from './callout.svelte';
	import CodeBlock from './code-block.svelte';
	import CommandField from './command-field.svelte';
	import Disclosure from './disclosure.svelte';
	import InlineText from './inline-text.svelte';
	import Steps, { type StepItem } from './steps.svelte';

	/**
	 * The guided setup of one MCP client: install (fastest method first), sign in (what the user
	 * will see, with the live connection state), try a prompt; then plan notes and the manual
	 * config. All texts and commands come from the client catalog (`#lib/core/mcp-clients.ts`).
	 */
	type Props = { guide: ClientGuide; status: OnboardingStatus; workspace: string };

	let { guide, status, workspace }: Props = $props();

	const install = $derived(guide.install);
	const connected = $derived(
		status.clients.find((client) => (matchClient(client.name) ?? 'other') === guide.id) ?? null
	);
	const others = $derived(status.clients.filter((client) => client !== connected));
	const prompts = $derived(samplePrompts(status.connectors));
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
			description: `Paste one of these in ${guide.name}.`,
			status: status.triedPrompt ? 'done' : connected ? 'current' : 'todo',
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
			description={connected.lastUsedAt
				? `Last used ${formatRelative(connected.lastUsedAt)}.`
				: `Signed in ${formatRelative(connected.connectedAt)}.`}
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

{#snippet tryStep()}
	{#if status.connectors.length === 0}
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
	{/if}
	{#each prompts as prompt (prompt)}
		<CommandField variant="prompt" value={prompt} />
	{/each}
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
