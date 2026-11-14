<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { authClient } from '#lib/auth-client.ts';
	import {
		Boundary,
		Callout,
		DataTable,
		FormDialog,
		FormField,
		KeyValueList,
		Page,
		RevealDialog,
		Section,
		StatusBadge,
		type Column
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import {
		confirmTwoFactorSetup,
		deleteMyAccount,
		disableTwoFactor,
		getAccount,
		removePasskey,
		startTwoFactorSetup
	} from '#lib/functions/account.remote.ts';

	const workspace = $derived(page.params.workspace!);

	let setupOpen = $state(false);
	let confirmOpen = $state(false);
	let disableOpen = $state(false);
	let deleteOpen = $state(false);
	let secrets = $state<{ secret: string; backupCodes: string[] } | null>(null);

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
	description="Your profile, sign-in security and your data."
	back={{ href: resolve('/w/[workspace]/settings', { workspace }), label: 'Settings' }}
>
	<Boundary>
		{@const account = await getAccount()}
		{@const hasFactor = account.twoFactorEnabled || account.passkeys.length > 0}

		{#if account.secondFactorRequired && !hasFactor}
			<Callout
				tone="warning"
				title="Add a second factor"
				description="You own or administer a company workspace: a passkey or two-factor authentication is required for admin actions."
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
			description="Sign in without a password; also counts as a second factor."
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
			title="Two-factor authentication"
			description="A 6-digit code from an authenticator app at sign-in."
		>
			{#snippet actions()}
				{#if account.twoFactorEnabled}
					<Button size="sm" variant="outline" onclick={() => (disableOpen = true)}>Turn off</Button>
				{:else}
					<Button size="sm" onclick={() => (setupOpen = true)}>Turn on</Button>
				{/if}
			{/snippet}
			<StatusBadge
				status={account.twoFactorEnabled ? 'active' : 'disabled'}
				label={account.twoFactorEnabled ? 'On' : 'Off'}
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
	bind:open={setupOpen}
	title="Turn on two-factor authentication"
	description="Confirm your password to generate a secret for your authenticator app."
	submitLabel="Continue"
	form={startTwoFactorSetup}
	onSuccess={(result) => {
		if (!result) return;
		secrets = { secret: result.secret, backupCodes: result.backupCodes };
	}}
>
	<FormField
		field={startTwoFactorSetup.fields.password}
		type="password"
		label="Password"
		autocomplete="current-password"
	/>
</FormDialog>

<RevealDialog
	bind:open={
		() => secrets !== null,
		(value) => {
			if (!value) {
				secrets = null;
				confirmOpen = true;
			}
		}
	}
	title="Add Toolkien to your authenticator app"
	description="Enter the secret key in your app, and keep the backup codes somewhere safe. They will not be shown again."
	values={secrets
		? [`Secret: ${secrets.secret}`, ...secrets.backupCodes.map((code) => `Backup code: ${code}`)]
		: []}
/>

<FormDialog
	bind:open={confirmOpen}
	title="Enter a code"
	description="Type the 6-digit code your app shows to finish."
	submitLabel="Turn on"
	form={confirmTwoFactorSetup}
	success="Two-factor authentication is on"
>
	<FormField
		field={confirmTwoFactorSetup.fields.code}
		type="text"
		label="Code"
		autocomplete="one-time-code"
	/>
</FormDialog>

<FormDialog
	bind:open={disableOpen}
	title="Turn off two-factor authentication?"
	submitLabel="Turn off"
	submitVariant="destructive"
	form={disableTwoFactor}
	success="Two-factor authentication is off"
>
	<FormField
		field={disableTwoFactor.fields.password}
		type="password"
		label="Password"
		autocomplete="current-password"
	/>
</FormDialog>

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
