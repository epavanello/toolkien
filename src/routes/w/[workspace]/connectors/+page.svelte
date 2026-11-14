<script lang="ts">
	import LibraryBig from '@lucide/svelte/icons/library-big';
	import Plus from '@lucide/svelte/icons/plus';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		Boundary,
		Callout,
		ConfirmDialog,
		DataTable,
		FormDialog,
		FormField,
		Page,
		ToolPath,
		type Column,
		type TableFilter
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import {
		addConnector,
		connectOAuth,
		disconnectConnector,
		listConnectors,
		refreshConnector,
		removeConnector,
		renameConnector,
		saveToken
	} from '#lib/functions/connectors.remote.ts';
	import type { ConnectorSummary } from '#lib/server/connectors/types.ts';
	import ConnectorPanel from './connector-panel.svelte';
	import { audienceLabel, describeSync } from './connectors.ts';

	const workspace = $derived(page.params.workspace!);
	const oauthResult = $derived(page.url.searchParams.get('oauth'));

	let selected = $state<string | null>(page.url.searchParams.get('connector'));
	let panelOpen = $state(page.url.searchParams.has('connector'));
	let urlOpen = $state(false);
	let tokenFor = $state<ConnectorSummary | null>(null);
	let removing = $state<ConnectorSummary | null>(null);
	let disconnecting = $state<ConnectorSummary | null>(null);
	let tokenOpen = $state(false);
	let removeOpen = $state(false);
	let disconnectOpen = $state(false);
	let renaming = $state<ConnectorSummary | null>(null);
	let renameOpen = $state(false);
	const askRename = (row: ConnectorSummary) => {
		renaming = row;
		renameOpen = true;
	};

	const open = (row: ConnectorSummary) => {
		selected = row.id;
		panelOpen = true;
	};

	/** OAuth: the browser goes to the upstream authorization page; tokens: paste dialog */
	function connect(row: ConnectorSummary) {
		if (row.authType === 'oauth') {
			return attempt(
				connectOAuth({ workspace, id: row.id }).then(({ authorizationUrl }) =>
					window.location.assign(authorizationUrl)
				)
			);
		}
		tokenFor = row;
		tokenOpen = true;
	}
	const askRemove = (row: ConnectorSummary) => {
		removing = row;
		removeOpen = true;
	};
	const askDisconnect = (row: ConnectorSummary) => {
		disconnecting = row;
		disconnectOpen = true;
	};
	const refresh = (row: ConnectorSummary) =>
		attempt(refreshConnector({ workspace, id: row.id }).then(describeSync));

	const columns: Column<ConnectorSummary>[] = [
		{
			key: 'label',
			header: 'Instance',
			value: (row) => row.label ?? row.name,
			searchable: true
		},
		{ key: 'namespace', header: 'Namespace', cell: namespaceCell, searchable: true },
		{ key: 'scope', header: 'Used by', type: 'badge', value: audienceLabel, hideOnMobile: true },
		{
			key: 'authenticated',
			header: 'Your access',
			type: 'status',
			value: (row) => (row.authenticated ? 'connected' : 'not_connected')
		},
		{
			key: 'status',
			header: 'Status',
			type: 'status',
			value: (row) => (row.suspended ? 'suspended' : row.status)
		},
		{ key: 'toolCount', header: 'Tools', type: 'number', hideOnMobile: true },
		{ key: 'lastSyncedAt', header: 'Last sync', type: 'datetime', hideOnMobile: true },
		{
			key: 'actions',
			header: 'Actions',
			type: 'actions',
			actions: (row) => [
				{ label: 'Details', onSelect: () => open(row) },
				{ label: 'Rename', hidden: !row.canManage, onSelect: () => askRename(row) },
				{
					label: 'Refresh tools',
					hidden: !row.authenticated || row.suspended,
					onSelect: () => refresh(row)
				},
				{
					label: row.authenticated ? 'Reconnect' : 'Connect',
					hidden: !row.canAuthenticate || row.authType === 'none',
					onSelect: () => connect(row)
				},
				{
					label: 'Disconnect',
					hidden: !row.canAuthenticate || !row.authenticated || row.authType === 'none',
					onSelect: () => askDisconnect(row)
				},
				{
					label: 'Remove',
					variant: 'destructive',
					hidden: !row.canManage,
					onSelect: () => askRemove(row)
				}
			]
		}
	];

	const filters: TableFilter<ConnectorSummary>[] = [
		{
			key: 'access',
			label: 'Access',
			options: [
				{ value: 'connected', label: 'Connected' },
				{ value: 'not_connected', label: 'Not connected' }
			],
			match: (row, value) => (value === 'connected') === row.authenticated
		}
	];
</script>

{#snippet namespaceCell(row: ConnectorSummary)}
	<ToolPath path={row.namespace} unverified={row.unverified} />
{/snippet}

<Page title="Connectors" description="Remote MCP servers your agents can use in this workspace.">
	{#snippet actions()}
		<Button
			variant="outline"
			icon={LibraryBig}
			href={resolve('/w/[workspace]/directory', { workspace })}>Browse directory</Button
		>
		<Button icon={Plus} onclick={() => (urlOpen = true)}>Add by URL</Button>
	{/snippet}

	{#if oauthResult === 'connected'}
		<Callout title="Connected" description="The account is connected and the tools were loaded." />
	{:else if oauthResult === 'denied'}
		<Callout tone="warning" title="Authorization cancelled" description="Nothing was connected." />
	{/if}

	<Boundary>
		{@const data = await listConnectors(workspace)}
		<DataTable
			label="Connectors"
			rows={data.connectors}
			{columns}
			{filters}
			rowKey={(row) => row.id}
			onRowClick={open}
			group={(row) => row.name}
			empty={{
				title: 'No connectors yet',
				description: 'Add one from the directory, or by URL if your workspace allows it.'
			}}
		/>

		<FormDialog
			bind:open={urlOpen}
			title="Add a server by URL"
			description="A remote MCP server (Streamable HTTP, https). Servers outside the directory are marked unverified."
			submitLabel="Add"
			form={addConnector}
		>
			<input {...addConnector.fields.workspace.as('hidden', workspace)} />
			<input {...addConnector.fields.source.as('hidden', 'url')} />
			<FormField
				field={addConnector.fields.url}
				type="url"
				label="Server URL"
				placeholder="https://mcp.example.com/mcp"
				required
			/>
			<FormField field={addConnector.fields.name} type="text" label="Name" placeholder="Optional" />
			<FormField
				field={addConnector.fields.label}
				type="text"
				label="Instance label"
				placeholder="Optional, e.g. the account or project"
			/>
			<FormField
				field={addConnector.fields.namespace}
				type="text"
				label="Namespace"
				placeholder="Optional, derived from the name and label"
			/>
			<FormField
				field={addConnector.fields.audience}
				type="select"
				label="Used by"
				options={[
					...(data.canAddForMe ? [{ value: 'mine', label: 'Only me (my account)' }] : []),
					...(data.canAddForWorkspace
						? [
								{ value: 'personal', label: 'Each member, with their own account' },
								{ value: 'shared', label: 'Everyone, with one shared account' }
							]
						: [])
				]}
			/>
			<FormField
				field={addConnector.fields.authType}
				type="select"
				label="Authentication"
				options={[
					{ value: 'auto', label: 'Detect (OAuth if the server supports it)' },
					{ value: 'oauth', label: 'OAuth' },
					{ value: 'token', label: 'Token / API key' },
					{ value: 'none', label: 'None' }
				]}
			/>
			{#if !data.canAddUrl}
				<Callout tone="warning" title="Only directory servers are allowed in this workspace." />
			{/if}
		</FormDialog>
	</Boundary>
</Page>

{#if selected}
	<ConnectorPanel
		{workspace}
		id={selected}
		bind:open={panelOpen}
		onConnect={connect}
		onDisconnect={askDisconnect}
		onRemove={askRemove}
		onRename={askRename}
	/>
{/if}

<FormDialog
	bind:open={tokenOpen}
	title="Connect {tokenFor?.name ?? ''}"
	description="Paste a token or API key. It is checked against the server, encrypted, and never shown again."
	submitLabel="Save token"
	form={saveToken}
	success="Connected"
>
	<input {...saveToken.fields.workspace.as('hidden', workspace)} />
	<input {...saveToken.fields.id.as('hidden', tokenFor?.id ?? '')} />
	<FormField
		field={saveToken.fields.token}
		type="password"
		label="Token"
		autocomplete="off"
		required
	/>
</FormDialog>

<FormDialog
	bind:open={renameOpen}
	title="Rename {renaming?.displayName ?? ''}"
	description="Label the account or project this instance targets. Changing the namespace changes its tool paths (agents get the new types; permissions are kept)."
	submitLabel="Save"
	form={renameConnector}
	success="Connector renamed"
>
	<input {...renameConnector.fields.workspace.as('hidden', workspace)} />
	<input {...renameConnector.fields.id.as('hidden', renaming?.id ?? '')} />
	<FormField
		field={renameConnector.fields.label}
		type="text"
		label="Instance label"
		placeholder="e.g. DevMotion"
		value={renaming?.label ?? ''}
	/>
	<FormField
		field={renameConnector.fields.namespace}
		type="text"
		label="Namespace"
		description="camelCase, unique in the workspace: scripts call namespace.tool()."
		value={renaming?.namespace ?? ''}
		required
	/>
</FormDialog>

<ConfirmDialog
	bind:open={disconnectOpen}
	title="Disconnect {disconnecting?.name ?? ''}?"
	description="The credential is revoked at the server when possible and deleted. Agents lose access until someone connects again."
	confirmLabel="Disconnect"
	onConfirm={() =>
		attempt(disconnectConnector({ workspace, id: disconnecting!.id }), 'Disconnected')}
/>

<ConfirmDialog
	bind:open={removeOpen}
	title="Remove {removing?.name ?? ''}?"
	description="Its tools, permissions and credentials are deleted, and tokens are revoked at the server when possible."
	confirmLabel="Remove"
	onConfirm={() =>
		attempt(removeConnector({ workspace, id: removing!.id }), 'Connector removed').then((ok) => {
			if (ok && selected === removing?.id) panelOpen = false;
			return ok;
		})}
/>
