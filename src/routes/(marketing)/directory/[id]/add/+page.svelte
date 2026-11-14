<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		addLabel,
		AuthHint,
		Boundary,
		Callout,
		FormField,
		RemoteForm,
		ServiceDetails
	} from '#lib/components/app/index.ts';
	import { AddServerCard } from '#lib/components/marketing/index.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { addConnector, getDirectoryAddTargets } from '#lib/functions/connectors.remote.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const entry = $derived(data.entry);
	const connectorHref = (workspace: string, id: string) =>
		`${resolve('/w/[workspace]/connectors', { workspace })}?connector=${encodeURIComponent(id)}`;
</script>

<SeoHead title={`Add ${entry.name}`} noindex />

<AddServerCard name={entry.name} icon={entry.icon} tagline={entry.tagline}>
	{#snippet hint()}<AuthHint authType={entry.authType} service={entry.name} />{/snippet}
	<Boundary>
		{@const targets = await getDirectoryAddTargets(entry.id)}
		{@const allowed = targets.filter((t) => t.canAdd)}
		{@const added = allowed.find((t) => t.installed.length > 0)}
		{#if !entry.supported}
			<ServiceDetails {entry} />
		{:else if allowed.length === 0}
			<Callout
				tone="warning"
				title="You cannot add servers yet"
				description="Your workspaces do not allow personal connectors. Ask a workspace admin to add it."
			/>
		{:else}
			{#if added}
				<Callout
					tone="success"
					title={`${entry.name} is already in ${added.name}`}
					description="Open it, or add another instance for a different account."
				>
					{#snippet action()}
						<Button size="sm" variant="outline" href={connectorHref(added.slug, added.installed[0])}
							>Open</Button
						>
					{/snippet}
				</Callout>
			{/if}
			<RemoteForm
				form={addConnector}
				submitLabel={addLabel(entry.authType, entry.name)}
				submit="block"
			>
				<input {...addConnector.fields.source.as('hidden', 'directory')} />
				<input {...addConnector.fields.directoryId.as('hidden', entry.id)} />
				<input {...addConnector.fields.audience.as('hidden', 'mine')} />
				{#if allowed.length === 1}
					<input {...addConnector.fields.workspace.as('hidden', allowed[0].slug)} />
				{:else}
					<FormField
						field={addConnector.fields.workspace}
						type="select"
						label="Workspace"
						options={allowed.map((t) => ({
							value: t.slug,
							label: t.personal ? `${t.name} (personal)` : t.name
						}))}
					/>
				{/if}
			</RemoteForm>
			<p class="text-center text-xs text-muted-foreground">
				Only you will use this connection. You can rename it later in Connectors.
			</p>
		{/if}
	</Boundary>
</AddServerCard>
