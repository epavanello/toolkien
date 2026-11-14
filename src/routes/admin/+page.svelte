<script lang="ts">
	import {
		Boundary,
		Callout,
		DataTable,
		FormDialog,
		FormField,
		Page,
		RemoteForm,
		Section,
		Stats,
		type Column
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { formatDateTime, formatDuration } from '#lib/core/format.ts';
	import {
		getPlatformOverview,
		pausePlatform,
		releaseSwitch,
		runJobNow,
		suspendUser,
		suspendWorkspaceBySlug,
		updatePlatformLimits
	} from '#lib/functions/admin.remote.ts';
	import type { LimitKey } from '#lib/server/limits/types.ts';

	type Overview = Awaited<ReturnType<typeof getPlatformOverview>>;

	let pauseOpen = $state(false);
	let userOpen = $state(false);
	let workspaceOpen = $state(false);

	const switchColumns: Column<Overview['switches'][number]>[] = [
		{ key: 'scope', header: 'Scope', type: 'badge' },
		{ key: 'targetLabel', header: 'Target', type: 'mono' },
		{ key: 'reason', header: 'Reason' },
		{ key: 'origin', header: 'By', type: 'badge', hideOnMobile: true },
		{ key: 'activatedAt', header: 'Since', type: 'datetime' },
		{
			key: 'status',
			header: 'Status',
			type: 'status',
			value: (s) => (s.releasedAt ? 'released' : 'active')
		},
		{
			key: 'actions',
			header: 'Actions',
			type: 'actions',
			actions: (s) => [
				{
					label: 'Release',
					hidden: !!s.releasedAt,
					onSelect: () => attempt(releaseSwitch(s.id), 'Released')
				}
			]
		}
	];

	const usageColumns: Column<Overview['usage'][number]>[] = [
		{ key: 'name', header: 'Workspace' },
		{ key: 'kind', header: 'Kind', type: 'badge', hideOnMobile: true },
		{ key: 'executions', header: 'Executions', type: 'number' },
		{ key: 'failedExecutions', header: 'Failed', type: 'number' },
		{ key: 'toolCalls', header: 'Tool calls', type: 'number' },
		{ key: 'executionMs', header: 'Run time', value: (r) => formatDuration(r.executionMs) }
	];

	const jobColumns: Column<Overview['jobs'][number]>[] = [
		{ key: 'name', header: 'Job', type: 'mono' },
		{ key: 'intervalMs', header: 'Every', value: (j) => formatDuration(j.intervalMs) },
		{ key: 'lastRunAt', header: 'Last run', type: 'datetime' },
		{
			key: 'lastOk',
			header: 'Result',
			type: 'status',
			value: (j) => (j.lastOk == null ? null : j.lastOk ? 'success' : 'failure')
		},
		{
			key: 'actions',
			header: 'Actions',
			type: 'actions',
			actions: (j) => [
				{ label: 'Run now', onSelect: () => attempt(runJobNow(j.name), 'Job finished') }
			]
		}
	];
</script>

<Page
	title="Platform admin"
	variant="detail"
	description="Limits, kill switches and usage for the whole platform."
>
	<Boundary>
		{@const o = await getPlatformOverview()}
		{#if !o.secondFactor}
			<Callout
				tone="warning"
				title="Changes need a second factor"
				description="Add a passkey in your account settings."
			/>
		{/if}
		{#if o.platformSwitch}
			<Callout
				tone="danger"
				title="Platform paused since {formatDateTime(o.platformSwitch.activatedAt)}"
				description="Reason: {o.platformSwitch
					.reason}. MCP access and executions are refused for everyone."
			>
				{#snippet action()}
					<Button
						size="sm"
						variant="outline"
						onclick={() => attempt(releaseSwitch(o.platformSwitch!.id), 'Platform resumed')}
						>Resume</Button
					>
				{/snippet}
			</Callout>
		{/if}

		<Stats
			items={[
				{ label: 'Users', value: o.totals.users },
				{ label: 'Workspaces', value: o.totals.workspaces },
				{ label: 'Running executions', value: o.concurrency.running },
				{
					label: 'Queued executions',
					value: o.concurrency.queued,
					tone: o.concurrency.queued ? 'pending' : 'neutral'
				}
			]}
		/>

		<Section
			title="Kill switches"
			variant="plain"
			description="Stop a user, a workspace or the whole platform at once. Connectors stay configured but suspended."
		>
			<DataTable
				label="Kill switches"
				rows={o.switches}
				columns={switchColumns}
				rowKey={(s) => s.id}
				searchable={false}
				empty={{ title: 'No kill switches' }}
			>
				{#snippet toolbar()}
					<Button size="sm" variant="outline" onclick={() => (userOpen = true)}>Suspend user</Button
					>
					<Button size="sm" variant="outline" onclick={() => (workspaceOpen = true)}
						>Suspend workspace</Button
					>
					{#if !o.platformSwitch}
						<Button size="sm" variant="destructive" onclick={() => (pauseOpen = true)}
							>Pause platform</Button
						>
					{/if}
				{/snippet}
			</DataTable>
		</Section>

		<Section
			title="Limits"
			description="Override the environment defaults. Rate limits and queues are in memory and reset on restart."
		>
			<RemoteForm form={updatePlatformLimits} submitLabel="Save limits" success="Limits saved">
				{#each Object.entries(o.fields) as [key, field] (key)}
					<FormField
						field={updatePlatformLimits.fields[key as LimitKey]}
						type="number"
						label={field.label}
						min={field.min}
						max={field.max}
						value={o.limits[key as LimitKey]}
						description="Default {o.defaults[key as LimitKey]}"
					/>
				{/each}
			</RemoteForm>
		</Section>

		<Section title="Usage, last 30 days" variant="plain">
			<DataTable
				label="Usage by workspace"
				rows={o.usage}
				columns={usageColumns}
				rowKey={(r) => r.workspaceId}
				empty={{ title: 'No usage yet' }}
			/>
		</Section>

		<Section title="Jobs" variant="plain">
			<DataTable
				label="Jobs"
				rows={o.jobs}
				columns={jobColumns}
				rowKey={(j) => j.name}
				searchable={false}
			/>
		</Section>
	</Boundary>
</Page>

<FormDialog
	bind:open={pauseOpen}
	title="Pause the whole platform?"
	description="Every MCP token and every session except platform admins' is revoked, and all executions stop."
	submitLabel="Pause platform"
	submitVariant="destructive"
	form={pausePlatform}
	success="Platform paused"
>
	<FormField field={pausePlatform.fields.reason} type="text" label="Reason" />
</FormDialog>
<FormDialog
	bind:open={userOpen}
	title="Suspend a user"
	description="Signs them out everywhere, revokes their MCP tokens and stops their executions."
	submitLabel="Suspend"
	submitVariant="destructive"
	form={suspendUser}
	success="User suspended"
>
	<FormField field={suspendUser.fields.email} type="email" label="Email" />
	<FormField field={suspendUser.fields.reason} type="text" label="Reason" />
</FormDialog>
<FormDialog
	bind:open={workspaceOpen}
	title="Suspend a workspace"
	description="Stops its executions and suspends its connectors. Only platform admins can lift it."
	submitLabel="Suspend"
	submitVariant="destructive"
	form={suspendWorkspaceBySlug}
	success="Workspace suspended"
>
	<FormField field={suspendWorkspaceBySlug.fields.slug} type="text" label="Workspace slug" />
	<FormField field={suspendWorkspaceBySlug.fields.reason} type="text" label="Reason" />
</FormDialog>
