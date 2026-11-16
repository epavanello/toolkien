<script lang="ts">
	import { resolve } from '$app/paths';
	import { attempt } from '#lib/core/attempt.ts';
	import {
		disconnectClient,
		moveClientWorkspace,
		renameClient,
		watchOnboarding
	} from '#lib/functions/onboarding.remote.ts';
	import type { AuthorizedClient, ClientWorkspace } from '#lib/server/clients/types.ts';
	import ConfirmDialog from './confirm-dialog.svelte';
	import DataTable from './data-table.svelte';
	import FormDialog from './form-dialog.svelte';
	import FormField from './form-field.svelte';
	import type { Column } from './data-table.ts';

	/**
	 * The AI clients (MCP clients) the signed-in user authorized, each with the workspace it works
	 * in (a link to it), and actions: Rename (the name the activity shows), Change workspace (only
	 * that client moves) and Disconnect behind a confirmation. Disconnecting revokes the client's access for this user in every workspace;
	 * pass the live onboarding status's `clients` so the list updates by itself.
	 */
	type Props = {
		clients: AuthorizedClient[];
		/** The user's workspaces, for Change workspace */
		workspaces: ClientWorkspace[];
		workspace: string;
	};

	let { clients, workspaces, workspace }: Props = $props();

	const workspaceLabel = (item: ClientWorkspace) =>
		item.kind === 'personal' && !/personal/i.test(item.name)
			? `${item.name} (personal)`
			: item.name;
	const workspaceOptions = $derived(
		workspaces.map((item) => ({ value: item.id, label: workspaceLabel(item) }))
	);

	let target = $state<AuthorizedClient | null>(null);
	let confirmOpen = $state(false);
	const ask = (client: AuthorizedClient) => {
		target = client;
		confirmOpen = true;
	};
	let moveOpen = $state(false);
	const move = (client: AuthorizedClient) => {
		target = client;
		moveOpen = true;
	};
	let renameOpen = $state(false);
	const rename = (client: AuthorizedClient) => {
		target = client;
		renameOpen = true;
	};

	const columns: Column<AuthorizedClient>[] = [
		{ key: 'name', header: 'Client' },
		{
			key: 'workspace',
			header: 'Workspace',
			value: (client) => (client.workspace ? workspaceLabel(client.workspace) : null),
			cell: workspaceCell
		},
		{ key: 'connectedAt', header: 'First authorized', type: 'datetime', hideOnMobile: true },
		{ key: 'lastUsedAt', header: 'Last used', type: 'datetime' },
		{
			key: 'actions',
			header: 'Actions',
			type: 'actions',
			actions: (client) => [
				{ label: 'Rename', onSelect: () => rename(client) },
				...(workspaces.length > 1
					? [{ label: 'Change workspace', onSelect: () => move(client) }]
					: []),
				{ label: 'Disconnect', variant: 'destructive', onSelect: () => ask(client) }
			]
		}
	];
</script>

<DataTable
	label="Connected clients"
	rows={clients}
	{columns}
	rowKey={(client) => client.clientId}
	searchable={false}
	empty={{
		title: 'No connected clients',
		description: 'AI clients you sign in from appear here.'
	}}
/>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Disconnect {target?.name ?? 'this client'}?"
	description="Its access and refresh tokens are revoked at once and it stops working in every workspace. To use it again, add Toolkien to it and sign in again."
	confirmLabel="Disconnect"
	onConfirm={() =>
		attempt(
			// The live status may have finished (onboarding complete): restart it to drop the row
			disconnectClient({ workspace, clientId: target!.clientId }).then(() =>
				watchOnboarding(workspace).reconnect()
			),
			`${target?.name ?? 'Client'} disconnected`
		)}
/>

<FormDialog
	bind:open={renameOpen}
	title="Rename {target?.name ?? 'client'}"
	description="The name Activity shows for this client from now on. Events already recorded keep their name."
	submitLabel="Save"
	form={renameClient}
	success="Client renamed"
>
	{#if target}
		{#key target.clientId}
			<input {...renameClient.fields.workspace.as('hidden', workspace)} />
			<input {...renameClient.fields.clientId.as('hidden', target.clientId)} />
			<FormField
				field={renameClient.fields.label}
				type="text"
				label="Name"
				description={target.registeredName
					? `Leave empty to use the client's own name, “${target.registeredName}”.`
					: undefined}
				value={target.name}
				placeholder={target.registeredName ?? undefined}
				autocomplete="off"
			/>
		{/key}
	{/if}
</FormDialog>

<FormDialog
	bind:open={moveOpen}
	title="Change workspace of {target?.name ?? 'client'}"
	description="Its next requests use this workspace's connectors and permissions. Your other clients stay where they are."
	submitLabel="Move"
	form={moveClientWorkspace}
	success="Workspace changed"
>
	{#if target}
		{#key target.clientId}
			<input {...moveClientWorkspace.fields.workspace.as('hidden', workspace)} />
			<input {...moveClientWorkspace.fields.clientId.as('hidden', target.clientId)} />
			<FormField
				field={moveClientWorkspace.fields.workspaceId}
				type="select"
				label="Workspace"
				options={workspaceOptions}
				value={target.workspace?.id}
			/>
		{/key}
	{/if}
</FormDialog>

{#snippet workspaceCell(client: AuthorizedClient)}
	{#if client.workspace}
		<a
			class="text-foreground underline-offset-4 hover:underline"
			href={resolve('/w/[workspace]', { workspace: client.workspace.slug })}
		>
			{workspaceLabel(client.workspace)}
		</a>
	{:else}
		<span class="text-muted-foreground">—</span>
	{/if}
{/snippet}
