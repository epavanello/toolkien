<script lang="ts">
	import { page } from '$app/state';
	import {
		addLabel,
		Boundary,
		Callout,
		DirectoryBrowser,
		Disclosure,
		EmptyState,
		FormField,
		Page,
		RemoteForm
	} from '#lib/components/app/index.ts';
	import { addConnector, listDirectoryServers } from '#lib/functions/connectors.remote.ts';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import { Button } from '#lib/components/ui/button/index.js';
	import { addServerUrl, contributingUrl, requestServerUrl } from './directory.ts';

	const workspace = $derived(page.params.workspace!);
</script>

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
		title={search ? `No server matches "${search}"` : 'No server in this category'}
		description="Request it, or add it to the directory with a pull request."
	>
		{#snippet action()}
			<div class="flex flex-wrap justify-center gap-2">{@render missingActions(search)}</div>
		{/snippet}
	</EmptyState>
{/snippet}

<Page
	title="Directory"
	description="Popular remote MCP servers, preconfigured and checked. Add one and your agents can use it through Toolkien."
>
	<Boundary>
		{@const data = await listDirectoryServers(workspace)}
		{@const canAdd = data.canAddForMe || data.canAddForWorkspace}
		<DirectoryBrowser
			entries={data.servers}
			added={(server) => server.installed.length > 0}
			cardButton={canAdd ? 'Add' : undefined}
			{noResults}
		>
			{#snippet panelAction(server)}
				{#if !canAdd}
					<Callout
						tone="warning"
						title="Personal connectors are disabled"
						description="Ask an admin to add this server for the workspace."
					/>
				{:else}
					<RemoteForm
						form={addConnector}
						submitLabel={addLabel(server.authType, server.name)}
						submit="block"
					>
						<input {...addConnector.fields.workspace.as('hidden', workspace)} />
						<input {...addConnector.fields.source.as('hidden', 'directory')} />
						<input {...addConnector.fields.directoryId.as('hidden', server.id)} />
						{#if server.installed.length > 0}
							<Callout
								title="Already in this workspace"
								description="Add another instance for a different account or project, with its own label."
							/>
						{/if}
						<Disclosure title="Options" description="Label, namespace, who uses it">
							<FormField
								field={addConnector.fields.label}
								type="text"
								label="Instance label"
								placeholder="e.g. DevMotion"
								description={`For several accounts or projects. Namespace: ${server.namespace}<Label>.`}
							/>
							<FormField
								field={addConnector.fields.namespace}
								type="text"
								label="Namespace"
								placeholder={server.namespace}
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
						</Disclosure>
					</RemoteForm>
				{/if}
			{/snippet}
		</DirectoryBrowser>
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
