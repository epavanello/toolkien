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
		ServiceLogo,
		SidePanel,
		SourceBadge,
		EmptyState,
		humanize,
		type Column,
		type TableFilter
	} from '#lib/components/app/index.ts';
	import { addConnector, listDirectoryServers } from '#lib/functions/connectors.remote.ts';
	import type { DirectoryEntry } from '#lib/server/connectors/types.ts';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { Button } from '#lib/components/ui/button/index.js';
	import { authLabel, checkLabel } from '../connectors/connectors.ts';
	import { addServerUrl, contributingUrl, requestServerUrl } from './directory.ts';

	type Server = DirectoryEntry & { installed: string[] };

	const workspace = $derived(page.params.workspace!);
	let selected = $state<Server | null>(null);
	let panelOpen = $state(false);

	const columns: Column<Server>[] = [
		{ key: 'name', header: 'Server', logo: (row) => row.icon },
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
			key: 'publisher',
			header: 'Source',
			cell: sourceCell,
			value: (row) => row.publisher,
			searchable: false
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
			key: 'publisher',
			label: 'Source',
			options: [
				{ value: 'official', label: 'Official' },
				{ value: 'community', label: 'Community' }
			],
			match: (row, value) => row.publisher === value
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

{#snippet sourceCell(row: Server)}
	<SourceBadge
		publisher={row.publisher}
		service={row.name}
		needsReview={row.verification.status === 'needs-review'}
		reviewNote={row.verification.notes}
	/>
{/snippet}

{#snippet missingActions(name: string)}
	<Button size="sm" icon={ExternalLink} href={requestServerUrl(name)} target="_blank" rel="noopener"
		>Request a server</Button
	>
	<Button
		size="sm"
		variant="outline"
		icon={ExternalLink}
		href={addServerUrl(name)}
		target="_blank"
		rel="noopener">Add it yourself</Button
	>
{/snippet}

{#snippet noResults(search: string)}
	<EmptyState
		title={search ? `No server matches "${search}"` : 'No server matches these filters'}
		description="Request it, or add it to the directory with a pull request."
	>
		{#snippet action()}
			<div class="flex flex-wrap justify-center gap-2">{@render missingActions(search)}</div>
		{/snippet}
	</EmptyState>
{/snippet}

<Page
	title="Directory"
	description="Remote MCP servers, preconfigured and checked. Official servers are run by the service itself; community servers by a third party, and their tools are treated as untrusted."
>
	<Boundary>
		{@const data = await listDirectoryServers(workspace)}
		<DataTable
			label="Directory"
			rows={data.servers}
			{columns}
			filters={filters(data.servers)}
			rowKey={(row) => row.id}
			{noResults}
			onRowClick={(row) => {
				selected = row;
				panelOpen = true;
			}}
		/>

		{#if selected}
			{@const s = selected}
			<SidePanel bind:open={panelOpen} title={s.name} description={s.description}>
				{#snippet media()}
					<ServiceLogo name={s.name} src={s.icon} size="md" />
				{/snippet}
				<KeyValueList
					items={[
						{ label: 'Server URL', value: s.url, type: 'mono', copy: true },
						{ label: 'Namespace', value: s.namespace, type: 'mono' },
						{ label: 'Authentication', value: authLabel(s.authType) },
						{ label: 'Scopes', value: s.scopes?.join(' ') ?? null, type: 'mono' },
						{ label: 'Homepage', value: s.homepage ?? null },
						{
							label: 'Publisher',
							value:
								s.publisher === 'official'
									? `Official (run by ${s.name})`
									: `Community (not maintained by ${s.name})`
						},
						{ label: 'Checked', value: checkLabel(s.verification.status) },
						{ label: 'Checked by', value: s.verification.by },
						{ label: 'Checked on', value: s.verification.on, type: 'datetime' },
						{ label: 'Tags', value: s.tags.join(', ') }
					]}
				/>
				{#if s.verification.notes}
					<Callout
						tone={s.verification.status === 'needs-review' ? 'warning' : 'info'}
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

	<Callout
		title="Missing a server?"
		description="Ask for it with a prefilled request, or add its entry yourself: GitHub opens a ready-to-fill file for a pull request."
	>
		{#snippet action()}
			{@render missingActions('')}
			<Button size="sm" variant="link" href={contributingUrl} target="_blank" rel="noopener"
				>Contributing guide</Button
			>
		{/snippet}
	</Callout>
</Page>
