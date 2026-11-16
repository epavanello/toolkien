<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		Boundary,
		ChoiceGrid,
		CLIENT_ICONS,
		ClientSetup,
		ConnectedClients,
		Page,
		Section,
		WelcomeChecklist,
		type ChoiceItem
	} from '#lib/components/app/index.ts';
	import { clientGuides, findGuide, matchClient, type ClientGuide } from '#lib/core/mcp-clients.ts';
	import { watchOnboarding } from '#lib/functions/onboarding.remote.ts';

	const workspace = $derived(page.params.workspace!);
	const selected = $derived(page.url.searchParams.get('client'));
	const href = (client: string) =>
		`${resolve('/w/[workspace]/connect', { workspace })}?client=${client}#setup`;

	const tiles = (guides: ClientGuide[], connected: Set<string>, group: ClientGuide['group']) =>
		guides
			.filter((guide) => guide.group === group)
			.map<ChoiceItem>((guide) => ({
				value: guide.id,
				label: guide.tile ?? guide.name,
				description: guide.kind,
				icon: CLIENT_ICONS[guide.id],
				done: connected.has(guide.id)
			}));
</script>

<Page
	variant="detail"
	title="Connect your AI"
	description="Add Toolkien to the AI client you use: one server, every tool you connected. It takes about a minute."
>
	<WelcomeChecklist {workspace} />
	<Boundary>
		{@const status = await watchOnboarding(workspace)}
		{@const guides = clientGuides(status.mcpUrl)}
		{@const connected = new Set(status.clients.map((c) => matchClient(c.name) ?? 'other'))}
		{@const guide = findGuide(guides, selected)}
		<Section
			variant="plain"
			title="Where do you want to use Toolkien?"
			description="Pick your client to get the fastest way to connect it."
		>
			<ChoiceGrid
				label="AI clients"
				value={selected}
				{href}
				groups={[
					{ items: tiles(guides, connected, 'main') },
					{ title: 'Other clients', size: 'sm', items: tiles(guides, connected, 'other') }
				]}
			/>
		</Section>
		{#if guide}
			<Section variant="plain" title="Connect {guide.name}" id="setup">
				<ClientSetup {guide} {status} {workspace} />
			</Section>
		{/if}
		{#if status.clients.length > 0}
			<Section
				variant="plain"
				title="Connected clients"
				description="AI clients you signed in from. Disconnect one to revoke its access at once."
				id="clients"
			>
				<ConnectedClients clients={status.clients} workspaces={status.workspaces} {workspace} />
			</Section>
		{/if}
	</Boundary>
</Page>
