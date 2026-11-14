<script lang="ts">
	import LinkIcon from '@lucide/svelte/icons/link';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		Boundary,
		Callout,
		ConfirmDialog,
		DataTable,
		FormDialog,
		FormField,
		Page,
		RevealDialog,
		Section,
		type Column
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import {
		changeMemberRole,
		createInvite,
		getMembers,
		removeWorkspaceMember,
		revokeInvite,
		transferWorkspaceOwnership
	} from '#lib/functions/workspaces.remote.ts';
	import type { InviteLinkSummary, MemberSummary } from '#lib/server/workspaces/types.ts';

	const workspace = $derived(page.params.workspace!);

	let inviteOpen = $state(false);
	let revealed = $state<string | null>(null);
	let emailed = $state(false);
	let confirm = $state<{ kind: 'remove' | 'leave' | 'transfer'; member: MemberSummary } | null>(
		null
	);

	const confirmCopy = {
		remove: {
			title: 'Remove member?',
			description:
				'They lose access at once. Their own connectors and credentials here are deleted.',
			label: 'Remove'
		},
		leave: {
			title: 'Leave this workspace?',
			description: 'You lose access at once. Your own connectors and credentials here are deleted.',
			label: 'Leave'
		},
		transfer: {
			title: 'Transfer ownership?',
			description:
				'The new owner can delete the workspace and transfer it again. You become an admin.',
			label: 'Transfer'
		}
	};

	async function confirmAction() {
		if (!confirm) return false;
		const { kind, member } = confirm;
		if (kind === 'transfer') {
			return attempt(
				transferWorkspaceOwnership({ workspace, userId: member.userId }),
				'Ownership transferred'
			);
		}
		let target: string | null = null;
		const ok = await attempt(
			removeWorkspaceMember({ workspace, userId: member.userId }).then(
				(result) => (target = result.redirectTo)
			),
			kind === 'remove' ? 'Member removed' : undefined
		);
		if (ok && target) {
			await goto(resolve('/w/[workspace]', { workspace: target }), { invalidateAll: true });
		}
		return ok;
	}

	function memberColumns(data: Awaited<ReturnType<typeof getMembers>>): Column<MemberSummary>[] {
		return [
			{ key: 'name', header: 'Name' },
			{ key: 'email', header: 'Email', type: 'mono', hideOnMobile: true },
			{
				key: 'role',
				header: 'Role',
				type: 'badge',
				badgeVariant: (m) => (m.role === 'member' ? 'secondary' : 'default')
			},
			...(data.isAdmin
				? [
						{
							key: 'secondFactor',
							header: 'Passkey',
							type: 'status' as const,
							value: (m: MemberSummary) => (m.secondFactor ? 'active' : 'missing')
						}
					]
				: []),
			{ key: 'joinedAt', header: 'Joined', type: 'datetime', hideOnMobile: true },
			{
				key: 'actions',
				header: 'Actions',
				type: 'actions',
				actions: (m) => {
					const self = m.userId === data.viewerId;
					return [
						{
							label: 'Make admin',
							hidden: !data.canManage || m.role !== 'member',
							onSelect: () =>
								attempt(
									changeMemberRole({ workspace, userId: m.userId, role: 'admin' }),
									'Role changed'
								)
						},
						{
							label: 'Make member',
							hidden: !data.canManage || m.role !== 'admin',
							onSelect: () =>
								attempt(
									changeMemberRole({ workspace, userId: m.userId, role: 'member' }),
									'Role changed'
								)
						},
						{
							label: 'Transfer ownership',
							hidden: !data.isOwner || self || !data.canManage,
							onSelect: () => (confirm = { kind: 'transfer', member: m })
						},
						{
							label: 'Leave workspace',
							variant: 'destructive',
							hidden: !self || m.role === 'owner' || data.workspace.kind === 'personal',
							onSelect: () => (confirm = { kind: 'leave', member: m })
						},
						{
							label: 'Remove',
							variant: 'destructive',
							hidden: self || !data.canManage || m.role === 'owner',
							onSelect: () => (confirm = { kind: 'remove', member: m })
						}
					];
				}
			}
		];
	}

	const inviteColumns: Column<InviteLinkSummary>[] = [
		{ key: 'role', header: 'Role', type: 'badge' },
		{
			key: 'email',
			header: 'Only for',
			type: 'mono',
			value: (i) => i.email ?? 'Anyone with the link'
		},
		{ key: 'uses', header: 'Uses', value: (i) => `${i.useCount} / ${i.maxUses ?? '∞'}` },
		{ key: 'expiresAt', header: 'Expires', type: 'datetime', hideOnMobile: true },
		{ key: 'createdByName', header: 'Created by', hideOnMobile: true },
		{ key: 'status', header: 'Status', type: 'status' },
		{
			key: 'actions',
			header: 'Actions',
			type: 'actions',
			actions: (i) => [
				{
					label: 'Revoke',
					variant: 'destructive',
					hidden: i.status !== 'active',
					onSelect: () => attempt(revokeInvite({ workspace, id: i.id }), 'Invite link revoked')
				}
			]
		}
	];
</script>

<Page title="Members" description="People in this workspace and their roles.">
	<Boundary>
		{@const data = await getMembers(workspace)}
		{#if data.workspace.kind === 'personal'}
			<Callout
				title="This is your personal workspace"
				description="Create a company workspace from Settings to invite people and share connectors."
			/>
		{/if}
		{#if data.needsSecondFactor}
			<Callout
				tone="warning"
				title="Second factor required"
				description="Owners and admins of company workspaces need a passkey before managing members."
			>
				{#snippet action()}
					<Button
						size="sm"
						variant="outline"
						href={resolve('/w/[workspace]/settings/account', { workspace })}
					>
						Account security
					</Button>
				{/snippet}
			</Callout>
		{/if}

		<DataTable
			label="Members"
			rows={data.members}
			columns={memberColumns(data)}
			rowKey={(m) => m.userId}
		>
			{#snippet toolbar()}
				{#if data.canManage}
					<Button size="sm" icon={LinkIcon} onclick={() => (inviteOpen = true)}>Invite link</Button>
				{/if}
			{/snippet}
		</DataTable>

		{#if data.canManage}
			<Section
				variant="plain"
				title="Invite links"
				description="Anyone with an active link can join with its role. Links are shown once; revoke them when done."
			>
				<DataTable
					label="Invite links"
					rows={data.invites}
					columns={inviteColumns}
					rowKey={(i) => i.id}
					searchable={false}
					empty={{ title: 'No invite links', description: 'Create one to add people.' }}
				/>
			</Section>
		{/if}
	</Boundary>
</Page>

<FormDialog
	bind:open={inviteOpen}
	title="Create an invite link"
	description="There are no invitation emails: share the link yourself."
	submitLabel="Create link"
	form={createInvite}
	onSuccess={(result) => {
		emailed = !!result?.emailed;
		revealed = result?.url ?? null;
	}}
>
	<input {...createInvite.fields.workspace.as('hidden', workspace)} />
	<FormField
		field={createInvite.fields.role}
		type="select"
		label="Role"
		value="member"
		options={[
			{ value: 'member', label: 'Member' },
			{ value: 'admin', label: 'Admin (needs a passkey)' }
		]}
	/>
	<FormField
		field={createInvite.fields.email}
		type="email"
		label="Only for this email"
		description="Optional. Leave empty for anyone with the link."
	/>
	<FormField
		field={createInvite.fields.maxUses}
		type="number"
		label="Maximum uses"
		min={1}
		max={1000}
		description="Optional. Empty = unlimited."
	/>
	<FormField
		field={createInvite.fields.expiresInDays}
		type="number"
		label="Expires after (days)"
		min={1}
		max={30}
		value={7}
	/>
</FormDialog>

<RevealDialog
	bind:open={() => revealed !== null, (value) => !value && (revealed = null)}
	title="Invite link created"
	description={emailed
		? 'We emailed it to the invited address. You can also copy it now: it will not be shown again.'
		: undefined}
	values={revealed ? [revealed] : []}
	copyEach
/>

<ConfirmDialog
	bind:open={() => confirm !== null, (value) => !value && (confirm = null)}
	title={confirmCopy[confirm?.kind ?? 'remove'].title}
	description={confirmCopy[confirm?.kind ?? 'remove'].description}
	confirmLabel={confirmCopy[confirm?.kind ?? 'remove'].label}
	variant={confirm?.kind === 'transfer' ? 'default' : 'destructive'}
	onConfirm={confirmAction}
/>
