<script lang="ts">
	import { page } from '$app/state';
	import {
		Boundary,
		Callout,
		DataTable,
		FormField,
		KeyValueList,
		Page,
		RemoteForm,
		Section,
		SidePanel,
		humanize,
		type Column,
		type TableFilter
	} from '#lib/components/app/index.ts';
	import { addConnector, listDirectoryServers } from '#lib/functions/connectors.remote.ts';
	import type { DirectoryEntry } from '#lib/server/connectors/types.ts';
	import { authLabel } from '../connectors/connectors.ts';

	type Server = DirectoryEntry & { installed: string[] };

	const workspace = $derived(page.params.workspace!);
	let selected = $state<Server | null>(null);
	let panelOpen = $state(false);

	const columns: Column<Server>[] = [
		{ key: 'name', header: 'Server' },
		{ key: 'description', header: 'Description', hideOnMobile: true },
		{
			key: 'category',
			header: 'Category',
			type: 'badge',
			value: (row) => humanize(row.category),
			hideOnMobile: true
		},
		{ key: 'authType', header: 'Auth', type: 'badge', value: (row) => authLabel(row.authType) },
		{
			key: 'verification',
			header: 'Review',
			type: 'status',
			value: (row) => row.verification.status
		},
		{
			key: 'installed',
			header: 'In workspace',
			value: (row) => (row.installed.length > 0 ? 'Added' : ''),
			searchable: false
		}
	];

	const filters = (servers: Server[]): TableFilter<Server>[] => [
		{
			key: 'category',
			label: 'Category',
			options: [...new Set(servers.map((s) => s.category))]
				.sort()
				.map((value) => ({ value, label: humanize(value) })),
			match: (row, value) => row.category === value
		},
		{
			key: 'auth',
			label: 'Auth',
			options: (['oauth', 'token', 'none'] as const).map((value) => ({
				value,
				label: authLabel(value)
			})),
			match: (row, value) => row.authType === value
		}
	];
</script>

<Page
	title="Directory"
	description="Community-reviewed remote MCP servers, preconfigured with verified tool annotations. Propose new ones with a pull request to the directory/ folder of the repository."
>
	<Boundary>
		{@const data = await listDirectoryServers(workspace)}
		<DataTable
			label="Directory"
			rows={data.servers}
			{columns}
			filters={filters(data.servers)}
			rowKey={(row) => row.id}
			onRowClick={(row) => {
				selected = row;
				panelOpen = true;
			}}
		/>

		{#if selected}
			{@const s = selected}
			<SidePanel bind:open={panelOpen} title={s.name} description={s.description}>
				<KeyValueList
					items={[
						{ label: 'Server URL', value: s.url, type: 'mono', copy: true },
						{ label: 'Namespace', value: s.namespace, type: 'mono' },
						{ label: 'Authentication', value: authLabel(s.authType) },
						{ label: 'Scopes', value: s.scopes?.join(' ') ?? null, type: 'mono' },
						{ label: 'Homepage', value: s.homepage ?? null },
						{ label: 'Review', value: s.verification.status, type: 'status' },
						{ label: 'Reviewed by', value: `${s.verification.by}, ${s.verification.on}` },
						{ label: 'Tags', value: s.tags.join(', ') }
					]}
				/>
				{#if s.verification.notes}
					<Callout
						tone={s.verification.status === 'unverified' ? 'warning' : 'info'}
						title="Reviewer notes"
						description={s.verification.notes}
					/>
				{/if}
				{#if Object.keys(s.toolNotes).length > 0 || Object.keys(s.annotations ?? {}).length > 0}
					<Section variant="plain" title="Verified tools">
						<KeyValueList
							items={Object.keys({ ...s.annotations, ...s.toolNotes }).map((name) => ({
								label: name,
								value: [
									s.annotations?.[name]?.readOnlyHint ? 'Read only' : null,
									s.annotations?.[name]?.destructiveHint ? 'Destructive' : null,
									s.toolNotes[name] ?? null
								]
									.filter(Boolean)
									.join(' · ')
							}))}
						/>
					</Section>
				{/if}
				<Section
					title="Add to this workspace"
					description={s.installed.length > 0
						? `Added ${s.installed.length} time(s). Add another instance for a different account or project, with its own label.`
						: 'Add one instance per account or project; the label tells agents which one they use.'}
				>
					{#if data.canAddForMe || data.canAddForWorkspace}
						<RemoteForm form={addConnector} submitLabel="Add connector">
							<input {...addConnector.fields.workspace.as('hidden', workspace)} />
							<input {...addConnector.fields.source.as('hidden', 'directory')} />
							<input {...addConnector.fields.directoryId.as('hidden', s.id)} />
							<FormField
								field={addConnector.fields.label}
								type="text"
								label="Instance label"
								placeholder="e.g. DevMotion"
								description={`Namespace: ${s.namespace}<Label>, e.g. ${s.namespace}Devmotion.`}
							/>
							<FormField
								field={addConnector.fields.namespace}
								type="text"
								label="Namespace"
								placeholder="Optional, derived from the label"
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
						</RemoteForm>
					{:else}
						<Callout
							tone="warning"
							title="Personal connectors are disabled"
							description="Ask an admin to add this server for the workspace."
						/>
					{/if}
				</Section>
			</SidePanel>
		{/if}
	</Boundary>
</Page>
