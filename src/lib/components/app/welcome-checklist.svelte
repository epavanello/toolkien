<script lang="ts">
	import { PersistedState } from 'runed';
	import { resolve } from '$app/paths';
	import { matchClient } from '#lib/core/mcp-clients.ts';
	import { watchOnboarding } from '#lib/functions/onboarding.remote.ts';
	import Checklist, { type ChecklistVariant } from './checklist.svelte';

	/**
	 * First-run checklist of a workspace (add a server, connect an AI client, try a prompt). Steps
	 * tick from real data (live). When the last one ticks, it says so for a few seconds and hides
	 * itself; complete or dismissed, it stays hidden (remembered in this browser, per workspace).
	 */
	type Props = { workspace: string; variant?: ChecklistVariant };

	let { workspace, variant = 'card' }: Props = $props();

	// svelte-ignore state_referenced_locally -- one checklist instance per workspace slug
	const dismissed = new PersistedState(`toolkien:welcome-dismissed:${workspace}`, false);
	const connect = $derived(resolve('/w/[workspace]/connect', { workspace }));
</script>

{#if !dismissed.current}
	<svelte:boundary>
		{@const status = await watchOnboarding(workspace)}
		{@const client = status.clients[0]}
		{@const items = [
			{
				label: 'Add a server',
				description: 'Pick a remote MCP server from the directory and sign in to it.',
				done: status.connectors.length > 0,
				href: resolve('/w/[workspace]/directory', { workspace }),
				action: 'Open directory'
			},
			{
				label: 'Connect your AI client',
				description: client
					? `Connected: ${client.name}.`
					: 'Claude, ChatGPT, Codex, Cursor, VS Code and more.',
				done: status.clients.length > 0,
				href: connect,
				action: 'Connect'
			},
			{
				label: 'Try a prompt',
				description: status.firstCall
					? `First call: ${status.firstCall.tool}${status.firstCall.clientName ? ` via ${status.firstCall.clientName}` : ''}.`
					: 'Ask your agent to use toolkien.',
				done: status.triedPrompt,
				href: client ? `${connect}?client=${matchClient(client.name) ?? 'other'}#try` : connect,
				action: 'See prompts'
			}
		]}
		<Checklist
			title="Get started"
			description="Three steps to your first tool call through Toolkien."
			completeMessage="You're all set: your agents now reach every server through Toolkien."
			{items}
			{variant}
			onDismiss={() => (dismissed.current = true)}
			onComplete={() => (dismissed.current = true)}
		/>
		{#snippet pending()}{/snippet}
		{#snippet failed()}{/snippet}
	</svelte:boundary>
{/if}
