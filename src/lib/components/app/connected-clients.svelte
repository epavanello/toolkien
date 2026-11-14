<script lang="ts">
	import { attempt } from '#lib/core/attempt.ts';
	import { disconnectClient, watchOnboarding } from '#lib/functions/onboarding.remote.ts';
	import type { AuthorizedClient } from '#lib/server/clients/types.ts';
	import ConfirmDialog from './confirm-dialog.svelte';
	import DataTable from './data-table.svelte';
	import type { Column } from './data-table.ts';

	/**
	 * The AI clients (MCP clients) the signed-in user authorized, with a Disconnect action behind
	 * a confirmation. Disconnecting revokes the client's access for this user in every workspace;
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

	const columns: Column<AuthorizedClient>[] = [
		{ key: 'name', header: 'Client' },
		{ key: 'connectedAt', header: 'First authorized', type: 'datetime', hideOnMobile: true },
		{ key: 'lastUsedAt', header: 'Last used', type: 'datetime' },
		{
			key: 'actions',
			header: 'Actions',
			type: 'actions',
			actions: (client) => [
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
