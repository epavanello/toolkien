<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import {
		Boundary,
		Callout,
		ConnectedClients,
		DataTable,
		FormDialog,
		FormField,
		KeyValueList,
		Page,
		Section,
		type Column
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { deleteMyAccount, getAccount, removePasskey } from '#lib/functions/account.remote.ts';
	import { watchOnboarding } from '#lib/functions/onboarding.remote.ts';

	const workspace = $derived(page.params.workspace!);

	let deleteOpen = $state(false);

	async function addPasskey() {
		const result = await authClient.passkey.addPasskey();
		if (result?.error) throw new Error(result.error.message ?? 'Could not add the passkey.');
		await getAccount().refresh();
	}

	type Passkey = Awaited<ReturnType<typeof getAccount>>['passkeys'][number];
	const passkeyColumns: Column<Passkey>[] = [
		{ key: 'name', header: 'Name', value: (p) => p.name ?? 'Passkey' },
		{
			key: 'deviceType',
			header: 'Type',
			type: 'badge',
			value: (p) => (p.deviceType === 'multiDevice' ? 'synced' : 'device-bound')
		},
		{ key: 'createdAt', header: 'Added', type: 'datetime' },
		{
			key: 'actions',
			header: 'Actions',
			type: 'actions',
			actions: (p) => [
				{
					label: 'Remove',
					variant: 'destructive',
					onSelect: () => attempt(removePasskey(p.id), 'Passkey removed')
				}
			]
		}
	];
</script>

<Page
	title="Account"
	variant="form"
	description="Your profile, passkeys and your data."
	back={{ href: resolve('/w/[workspace]/settings', { workspace }), label: 'Settings' }}
>
	<Boundary>
		{@const account = await getAccount()}
		{#if account.secondFactorRequired && account.passkeys.length === 0}
			<Callout
				tone="warning"
				title="Add a passkey"
				description="You own or administer a company workspace: a passkey is required for admin actions."
			/>
		{/if}

		<Section title="Profile">
			<KeyValueList
				items={[
					{ label: 'Name', value: account.user.name },
					{ label: 'Email', value: account.user.email, type: 'mono' },
					{ label: 'Member since', value: account.user.createdAt, type: 'datetime' }
				]}
			/>
		</Section>

		<Section
			title="Passkeys"
			variant="plain"
			description="Sign in with your device instead of an email code. Required for owners and admins of company workspaces."
		>
			<DataTable
				label="Passkeys"
				rows={account.passkeys}
				columns={passkeyColumns}
				rowKey={(p) => p.id}
				searchable={false}
				empty={{ title: 'No passkeys yet' }}
			>
				{#snippet toolbar()}
					<Button size="sm" icon={KeyRound} onclick={() => attempt(addPasskey(), 'Passkey added')}>
						Add passkey
					</Button>
				{/snippet}
			</DataTable>
		</Section>

		<Section
			title="Connected AI clients"
			variant="plain"
			description="MCP clients (Claude, ChatGPT, Cursor…) you signed in to Toolkien from. Disconnecting one revokes its access in every workspace."
		>
			{@const onboarding = await watchOnboarding(workspace)}
			<ConnectedClients
				clients={onboarding.clients}
				workspaces={onboarding.workspaces}
				{workspace}
			/>
		</Section>

		<Section
			title="Your data"
			description="Everything Toolkien stores about you, as JSON. Never tokens, arguments, results or script code."
		>
			<div>
				<Button
					variant="outline"
					icon={Download}
					href={resolve('/w/[workspace]/settings/account/export.json', { workspace })}
					data-sveltekit-reload
				>
					Download my data
				</Button>
			</div>
		</Section>

		<Section
			tone="danger"
			title="Delete account"
			description="Deletes your personal workspace and the workspaces only you belong to, revokes upstream tokens where the provider allows it, and anonymises your entries in other workspaces' activity logs. This cannot be undone."
		>
			{#if account.deletionBlockers.length > 0}
				<Callout
					tone="warning"
					title="Transfer ownership first"
					description="You own {account.deletionBlockers
						.map((b) => b.name)
						.join(', ')}, which still has other members."
				/>
			{:else}
				<div>
					<Button variant="destructive" onclick={() => (deleteOpen = true)}
						>Delete my account</Button
					>
				</div>
			{/if}
		</Section>
	</Boundary>
</Page>

<FormDialog
	bind:open={deleteOpen}
	title="Delete your account?"
	description="Type your email address to confirm. This cannot be undone."
	submitLabel="Delete account"
	submitVariant="destructive"
	form={deleteMyAccount}
>
	<FormField field={deleteMyAccount.fields.confirmEmail} type="email" label="Email" />
</FormDialog>
