<script lang="ts">
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import {
		Boundary,
		Callout,
		EmptyState,
		KeyValueList,
		Section,
		SidePanel,
		ToolDefinition,
		UnverifiedBadge
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { getConnector, refreshConnector } from '#lib/functions/connectors.remote.ts';
	import type { ConnectorSummary } from '#lib/server/connectors/types.ts';
	import { audienceLabel, authLabel, describeSync } from './connectors.ts';

	/** Details of one connector: status, auth, and every tool with its TypeScript signature */
	type Props = {
		workspace: string;
		id: string;
		open?: boolean;
		onConnect: (connector: ConnectorSummary) => unknown;
		onDisconnect: (connector: ConnectorSummary) => unknown;
		onRemove: (connector: ConnectorSummary) => unknown;
		onRename: (connector: ConnectorSummary) => unknown;
	};

	let {
		workspace,
		id,
		open = $bindable(false),
		onConnect,
		onDisconnect,
		onRemove,
		onRename
	}: Props = $props();

	const refresh = () =>
		attempt(refreshConnector({ workspace, id }).then((result) => describeSync(result)));
</script>

<SidePanel bind:open title="Connector" size="xl">
	<Boundary>
		{@const c = await getConnector({ workspace, id })}
		<Section variant="plain" title={c.displayName} description={c.directory?.description}>
			{#snippet actions()}
				{#if c.unverified}<UnverifiedBadge />{/if}
				{#if c.canAuthenticate && c.authType !== 'none'}
					{#if c.authenticated}
						<Button size="sm" variant="outline" onclick={() => onDisconnect(c)}>Disconnect</Button>
					{/if}
					<Button size="sm" variant="outline" onclick={() => onConnect(c)}
						>{c.authenticated ? 'Reconnect' : 'Connect'}</Button
					>
				{/if}
				{#if c.canManage}
					<Button size="sm" variant="outline" onclick={() => onRename(c)}>Rename</Button>
					<Button size="sm" variant="destructive" onclick={() => onRemove(c)}>Remove</Button>
				{/if}
			{/snippet}
			<KeyValueList
				columns={2}
				items={[
					{ label: 'Server URL', value: c.url, type: 'mono', copy: true },
					{ label: 'Namespace', value: c.namespace, type: 'mono' },
					{ label: 'Instance', value: c.label },
					{ label: 'Used by', value: audienceLabel(c) },
					{ label: 'Authentication', value: authLabel(c.authType) },
					{
						label: 'Your access',
						value: c.authenticated ? 'connected' : 'not_connected',
						type: 'status'
					},
					{ label: 'Status', value: c.suspended ? 'suspended' : c.status, type: 'status' },
					{ label: 'MCP version', value: c.protocolVersion, type: 'mono' },
					{
						label: 'Server',
						value: c.serverInfo ? `${c.serverInfo.name} ${c.serverInfo.version}` : null
					},
					{ label: 'Last sync', value: c.lastSyncedAt, type: 'datetime' },
					{
						label: 'Directory',
						value: c.directory
							? `${c.directory.verification.status} · ${c.directory.verification.by}, ${c.directory.verification.on}`
							: c.unverified
								? 'Free URL (unverified)'
								: null
					}
				]}
			/>
		</Section>

		{#if c.suspended}
			<Callout
				tone="danger"
				title="Suspended"
				description="This connector is suspended: its tools cannot be called until an admin lifts the suspension."
			/>
		{:else if !c.authenticated}
			<Callout
				tone="warning"
				title="Not connected"
				description={c.canAuthenticate
					? 'Connect your account so agents can use these tools.'
					: 'An admin must connect this shared connector.'}
			>
				{#snippet action()}
					{#if c.canAuthenticate}<Button size="sm" onclick={() => onConnect(c)}>Connect</Button
						>{/if}
				{/snippet}
			</Callout>
		{:else if c.status === 'error' && c.statusMessage}
			<Callout tone="danger" title="Last sync failed" description={c.statusMessage} />
		{/if}
		{#if c.unverified}
			<Callout
				tone="warning"
				title="Unverified server"
				description="Its tool descriptions come from a server outside the curated directory: agents see them flagged as untrusted, and you confirm each tool's permission."
			/>
		{/if}
		{#if c.directory?.tokenHelp && !c.authenticated}
			<Callout title="Token" description={c.directory.tokenHelp} />
		{/if}

		<Section variant="flush" title="Tools" description="What agents can call, as TypeScript.">
			{#snippet actions()}
				<Button size="sm" variant="outline" icon={RefreshCw} onclick={refresh}>Refresh</Button>
			{/snippet}
			{#if c.tools.length === 0}
				<EmptyState
					title="No tools yet"
					description={c.authenticated ? 'Refresh to load the tool list.' : 'Connect first.'}
				/>
			{:else}
				{#each c.tools as tool (tool.id)}
					<ToolDefinition tool={{ ...tool, unverified: c.unverified }} />
				{/each}
			{/if}
		</Section>
	</Boundary>
</SidePanel>
