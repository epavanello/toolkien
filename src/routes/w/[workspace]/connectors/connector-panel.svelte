<script lang="ts">
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import {
		Boundary,
		Callout,
		EmptyState,
		KeyValueList,
		Section,
		SidePanel,
		SourceBadge,
		ToolDefinition
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { getConnector, refreshConnector } from '#lib/functions/connectors.remote.ts';
	import type { ConnectorSummary } from '#lib/server/connectors/types.ts';
	import {
		accessStatus,
		audienceLabel,
		authLabel,
		checkLabel,
		describeSync,
		needsSignIn,
		signInLabel,
		untrustedReason
	} from './connectors.ts';

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
				<SourceBadge
					publisher={c.publisher}
					service={c.directory?.name ?? c.name}
					needsReview={c.needsReview}
					reviewNote={c.directory?.verification.notes}
				/>
				{#if c.canAuthenticate && c.authType !== 'none'}
					{#if c.authenticated}
						<Button size="sm" variant="outline" onclick={() => onDisconnect(c)}>Disconnect</Button>
					{/if}
					<Button size="sm" variant="outline" onclick={() => onConnect(c)}
						>{signInLabel(c)}</Button
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
					{ label: 'Your access', value: accessStatus(c), type: 'status' },
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
							? `${checkLabel(c.directory.verification.status)} · ${c.directory.verification.by}, ${c.directory.verification.on}`
							: 'Not in the directory'
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
		{:else if needsSignIn(c)}
			<Callout
				tone="warning"
				title="This server needs you to sign in"
				description={c.statusMessage ??
					(c.authType === 'token'
						? 'Paste a token or API key from the server so agents can use its tools.'
						: `Sign in with your ${c.name} account so agents can use its tools.`)}
			>
				{#snippet action()}
					<Button size="sm" onclick={() => onConnect(c)}>{signInLabel(c)}</Button>
				{/snippet}
			</Callout>
		{:else if !c.authenticated}
			<Callout
				tone="warning"
				title="Not connected"
				description="An admin must connect this shared connector before agents can use it."
			/>
		{:else if c.status === 'error'}
			<Callout
				tone="danger"
				title="Could not load the tools"
				description={c.statusMessage ?? 'The server did not answer as expected.'}
			>
				{#snippet action()}
					<Button size="sm" variant="outline" icon={RefreshCw} onclick={refresh}
						>Retry</Button
					>
				{/snippet}
			</Callout>
		{:else if c.statusMessage}
			<Callout title="Note" description={c.statusMessage} />
		{/if}
		{#if c.unverified}
			<Callout tone="warning" title="Untrusted tool descriptions" description={untrustedReason(c)} />
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
					description={c.authenticated
						? 'Refresh to load the tool list.'
						: 'Sign in first: the tools load right after.'}
				/>
			{:else}
				{#each c.tools as tool (tool.id)}
					<ToolDefinition tool={{ ...tool, unverified: c.unverified }} />
				{/each}
			{/if}
		</Section>
	</Boundary>
</SidePanel>
