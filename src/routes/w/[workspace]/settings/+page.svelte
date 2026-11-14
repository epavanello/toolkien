<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		Boundary,
		Callout,
		FormDialog,
		FormField,
		KeyValueList,
		Page,
		RelativeTime,
		RemoteForm,
		Section,
		Stats
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { formatDuration } from '#lib/core/format.ts';
	import {
		cancelWorkspaceDeletion,
		createCompanyWorkspace,
		getWorkspaceSettings,
		getWorkspaceUsage,
		renameWorkspaceForm,
		resumeWorkspace,
		scheduleWorkspaceDeletion,
		suspendWorkspace,
		updatePolicyForm
	} from '#lib/functions/workspaces.remote.ts';

	const workspace = $derived(page.params.workspace!);
	// `?new` (workspace switcher link) opens the new company workspace dialog
	let createOpen = $state(page.url.searchParams.has('new'));
	let deleteOpen = $state(false);
	let suspendOpen = $state(false);

	const floors = [
		{ value: '', label: 'No floor' },
		{ value: 'ask', label: 'Ask for confirmation at least' },
		{ value: 'block', label: 'Block everything' }
	];
</script>

<Page title="Settings" variant="form">
	{#snippet actions()}
		<Button
			size="sm"
			variant="outline"
			href={resolve('/w/[workspace]/settings/account', { workspace })}
		>
			Account
		</Button>
	{/snippet}
	<Boundary>
		{@const s = await getWorkspaceSettings(workspace)}
		{@const usage = await getWorkspaceUsage(workspace)}
		{@const company = s.workspace.kind === 'company'}

		{#if s.deletion}
			<Callout
				tone="danger"
				title="Scheduled for deletion"
				time={{ value: s.deletion.purgeAt }}
				description="Nothing can run in this workspace. Everything is deleted when the grace period ends."
			>
				{#snippet action()}
					{#if s.isOwner}
						<Button
							size="sm"
							variant="outline"
							onclick={() => attempt(cancelWorkspaceDeletion(workspace), 'Deletion cancelled')}
						>
							Cancel deletion
						</Button>
					{/if}
				{/snippet}
			</Callout>
		{/if}
		{#if s.killSwitch}
			<Callout
				tone="danger"
				title="Workspace suspended"
				description="Reason: {s.killSwitch
					.reason}. Executions are stopped and connectors are suspended; their configuration is kept."
			>
				{#snippet action()}
					{#if s.canManage && s.killSwitch?.origin === 'workspace_admin'}
						<Button
							size="sm"
							variant="outline"
							onclick={() =>
								attempt(resumeWorkspace({ workspace, id: s.killSwitch!.id }), 'Workspace resumed')}
						>
							Resume
						</Button>
					{/if}
				{/snippet}
			</Callout>
		{/if}
		{#if company && s.isAdmin && !s.secondFactor}
			<Callout
				tone="warning"
				title="Second factor required"
				description="Owners and admins of company workspaces need a passkey to change settings."
			>
				{#snippet action()}
					<Button
						size="sm"
						variant="outline"
						href={resolve('/w/[workspace]/settings/account', { workspace })}
					>
						Set up
					</Button>
				{/snippet}
			</Callout>
		{/if}

		<Section title="Workspace">
			<KeyValueList
				items={[
					{ label: 'Name', value: s.workspace.name },
					{ label: 'Slug', value: s.workspace.slug, type: 'mono', copy: true },
					{ label: 'Kind', value: company ? 'Company' : 'Personal' },
					{ label: 'Your role', value: s.workspace.role }
				]}
			/>
		</Section>

		{#if company && s.canManage}
			<Section title="Name">
				<RemoteForm form={renameWorkspaceForm} submitLabel="Save" success="Workspace renamed">
					<input {...renameWorkspaceForm.fields.workspace.as('hidden', workspace)} />
					<FormField
						field={renameWorkspaceForm.fields.name}
						type="text"
						label="Workspace name"
						value={s.workspace.name}
					/>
				</RemoteForm>
			</Section>
		{/if}

		{#if company}
			<Section
				title="Policy"
				description="Rules for members. They can only make permissions stricter, never looser."
			>
				{#if s.canManage}
					<RemoteForm form={updatePolicyForm} submitLabel="Save policy" success="Policy saved">
						<input {...updatePolicyForm.fields.workspace.as('hidden', workspace)} />
						<FormField
							field={updatePolicyForm.fields.allowedServers}
							type="textarea"
							label="Allowed servers"
							description="One directory id (github) or https URL per line. Empty: every server is allowed."
							value={s.policy.allowedServers?.join('\n') ?? ''}
						/>
						<FormField
							field={updatePolicyForm.fields.allowPersonalConnectors}
							type="checkbox"
							label="Members may add their own connectors"
							checked={s.policy.allowPersonalConnectors}
						/>
						<FormField
							field={updatePolicyForm.fields.allowFreeUrls}
							type="checkbox"
							label="Allow servers outside the directory (unverified URLs)"
							checked={s.policy.allowFreeUrls}
						/>
						<FormField
							field={updatePolicyForm.fields.permissionFloor}
							type="select"
							label="Permission floor"
							options={floors}
							value={s.policy.permissionFloor ?? ''}
							description="Minimum level for every tool; per-tool floors are set in Permissions."
						/>
					</RemoteForm>
				{:else}
					<KeyValueList
						items={[
							{ label: 'Allowed servers', value: s.policy.allowedServers?.join(', ') || 'All' },
							{
								label: 'Own connectors',
								value: s.policy.allowPersonalConnectors ? 'Allowed' : 'Not allowed'
							},
							{
								label: 'Unverified URLs',
								value: s.policy.allowFreeUrls ? 'Allowed' : 'Not allowed'
							},
							{ label: 'Permission floor', value: s.policy.permissionFloor ?? 'None' }
						]}
					/>
				{/if}
			</Section>
		{/if}

		<Section
			title="Usage"
			description="Last 30 days (UTC). Toolkien is free during the early phase."
		>
			<Stats
				items={[
					{ label: 'Executions', value: usage.executions },
					{
						label: 'Failed',
						value: usage.failedExecutions,
						tone: usage.failedExecutions ? 'error' : 'neutral'
					},
					{ label: 'Tool calls', value: usage.toolCalls },
					{ label: 'Run time', value: formatDuration(usage.executionMs) }
				]}
			/>
		</Section>

		<Section
			title="Company workspaces"
			description="Share connectors with your team, with roles and an admin policy."
		>
			{#snippet actions()}
				<Button size="sm" variant="outline" icon={Building2} onclick={() => (createOpen = true)}>
					New company workspace
				</Button>
			{/snippet}
			<p class="text-sm text-muted-foreground">You become its owner; owners need a passkey.</p>
		</Section>

		{#if company && s.canManage}
			<Section
				tone="danger"
				title="Kill switch"
				description="Stops every execution at once and suspends the workspace's connectors (their configuration is kept)."
			>
				{#if s.killSwitch}
					<p class="text-sm text-muted-foreground">
						Suspended since <RelativeTime value={s.killSwitch.activatedAt} />.
					</p>
					{#if s.killSwitch.origin === 'workspace_admin'}
						<div>
							<Button
								variant="outline"
								onclick={() =>
									attempt(
										resumeWorkspace({ workspace, id: s.killSwitch!.id }),
										'Workspace resumed'
									)}
							>
								Resume workspace
							</Button>
						</div>
					{/if}
				{:else}
					<div>
						<Button variant="destructive" onclick={() => (suspendOpen = true)}
							>Suspend workspace</Button
						>
					</div>
				{/if}
			</Section>
		{/if}

		{#if company && s.isOwner && s.canManage && !s.deletion}
			<Section
				tone="danger"
				title="Delete workspace"
				description="Members lose access and executions stop at once. Everything is deleted after a 7-day grace period, during which you can cancel."
			>
				<div>
					<Button variant="destructive" onclick={() => (deleteOpen = true)}>Delete workspace</Button
					>
				</div>
			</Section>
		{/if}

		<FormDialog
			bind:open={deleteOpen}
			title="Delete {s.workspace.name}?"
			description="Type {s.workspace.slug} to confirm. You can cancel during the next 7 days."
			submitLabel="Schedule deletion"
			submitVariant="destructive"
			form={scheduleWorkspaceDeletion}
			success="Deletion scheduled"
		>
			<input {...scheduleWorkspaceDeletion.fields.workspace.as('hidden', workspace)} />
			<FormField
				field={scheduleWorkspaceDeletion.fields.confirm}
				type="text"
				label="Workspace slug"
				placeholder={s.workspace.slug}
			/>
		</FormDialog>
	</Boundary>
</Page>

<FormDialog
	bind:open={createOpen}
	title="New company workspace"
	submitLabel="Create"
	form={createCompanyWorkspace}
>
	<FormField
		field={createCompanyWorkspace.fields.name}
		type="text"
		label="Name"
		placeholder="Acme"
	/>
</FormDialog>

<FormDialog
	bind:open={suspendOpen}
	title="Suspend this workspace?"
	description="Running executions are cancelled and nothing can run until an admin resumes it."
	submitLabel="Suspend"
	submitVariant="destructive"
	form={suspendWorkspace}
	success="Workspace suspended"
>
	<input {...suspendWorkspace.fields.workspace.as('hidden', workspace)} />
	<FormField
		field={suspendWorkspace.fields.reason}
		type="text"
		label="Reason"
		placeholder="Suspected token leak"
	/>
</FormDialog>
