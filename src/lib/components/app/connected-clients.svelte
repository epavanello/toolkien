<script lang="ts">
	import { attempt } from '#lib/core/attempt.ts';
	import {
		disconnectClient,
		renameClient,
		watchOnboarding
	} from '#lib/functions/onboarding.remote.ts';
	import type { AuthorizedClient } from '#lib/server/clients/types.ts';
	import ConfirmDialog from './confirm-dialog.svelte';
	import DataTable from './data-table.svelte';
	import FormDialog from './form-dialog.svelte';
	import FormField from './form-field.svelte';
	import type { Column } from './data-table.ts';

	/**
	 * The AI clients (MCP clients) the signed-in user authorized, with Rename (the name the
	 * activity shows) and a Disconnect action behind a confirmation. Disconnecting revokes the client's access for this user in every workspace;
	 * pass the live onboarding status's `clients` so the list updates by itself.
	 */
	type Props = { clients: AuthorizedClient[]; workspace: string };

	let { clients, workspace }: Props = $props();

	let target = $state<AuthorizedClient | null>(null);
	let confirmOpen = $state(false);
	const ask = (client: AuthorizedClient) => {
		target = client;
		confirmOpen = true;
	};
	let renameOpen = $state(false);
	const rename = (client: AuthorizedClient) => {
		target = client;
		renameOpen = true;
	};

	const columns: Column<AuthorizedClient>[] = [
		{ key: 'name', header: 'Client' },
		{ key: 'connectedAt', header: 'First authorized', type: 'datetime', hideOnMobile: true },
		{ key: 'lastUsedAt', header: 'Last used', type: 'datetime' },
		{
			key: 'actions',
			header: 'Actions',
			type: 'actions',
			actions: (client) => [
				{ label: 'Rename', onSelect: () => rename(client) },
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
