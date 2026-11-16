<script lang="ts">
	import { page } from '$app/state';
	import {
		Boundary,
		BulkLevelMenu,
		ContextSavings,
		Disclosure,
		EmptyState,
		FilterBar,
		filterPermissions,
		groupDefault,
		LEVEL_FILTER_OPTIONS,
		Mono,
		Page,
		permissionSummary,
		Section,
		ServiceLogo,
		ToolGroupList,
		ToolPermissionRow,
		UnverifiedBadge
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { listConnectors } from '#lib/functions/connectors.remote.ts';
	import { getContextFootprint, listPermissions } from '#lib/functions/permissions.remote.ts';
	import {
		connectorSections,
		heaviestConnector,
		OPEN_BY_DEFAULT_MAX_TOOLS
	} from './permissions.ts';

	const workspace = $derived(page.params.workspace!);

	let search = $state('');
	let values = $state<Record<string, string>>({});
	/** Sections the viewer opened or closed; the others follow `openByDefault` */
	let opened = $state<Record<string, boolean>>({});
	const narrowed = $derived(search.trim() !== '' || !!values.level);

	/** A new search or filter opens every section again, so no match stays folded away */
	const narrow = (apply: () => void) => (apply(), (opened = {}));
</script>

<Page
	title="Permissions"
	description="Choose which tools run freely, ask you first, or are blocked, connector by connector and by what each tool does. Blocked tools are hidden from agents; every call is checked again when it runs."
>
	<Boundary>
		{@const [data, { connectors }, footprint] = await Promise.all([
			listPermissions(workspace),
			listConnectors(workspace),
			getContextFootprint(workspace)
		])}
		{@const sections = connectorSections(data.tools, connectors)}
		{@const openByDefault =
			narrowed || sections.length === 1 || data.tools.length <= OPEN_BY_DEFAULT_MAX_TOOLS}
		{@const isOpen = (id: string) => opened[id] ?? openByDefault}
		{@const allOpen = sections.every((section) => isOpen(section.id))}
		{@const shown = sections
			.map((section) => ({
				...section,
				shown: filterPermissions(section.tools, search, values.level ?? '')
			}))
			.filter((section) => section.shown.length > 0)}

		{#if data.tools.length === 0}
			<EmptyState
				art="seal"
				title="No tools yet"
				description="Add a connector: its tools show up here with their default levels."
			/>
		{:else}
			<Section
				title="Context savings"
				description="What your agents carry before their first message: every tool connected natively, or Toolkien's six."
			>
				<ContextSavings
					tools={footprint.native.tools}
					connectors={footprint.native.connectors.length}
					nativeChars={footprint.native.chars}
					gatewayChars={footprint.gatewayChars}
					heaviest={heaviestConnector(footprint.native, connectors)}
				/>
			</Section>

			<FilterBar
				bind:search={() => search, (value) => narrow(() => (search = value))}
				bind:values={() => values, (value) => narrow(() => (values = value))}
				searchPlaceholder="Search tools or connectors…"
				filters={[{ key: 'level', label: 'Level', options: LEVEL_FILTER_OPTIONS }]}
			>
				{#snippet end()}
					<Button
						size="sm"
						variant="outline"
						onclick={() =>
							(opened = Object.fromEntries(sections.map((section) => [section.id, !allOpen])))}
					>
						{allOpen ? 'Collapse all' : 'Expand all'}
					</Button>
				{/snippet}
			</FilterBar>

			{#each shown as section (section.id)}
				{@const subject = narrowed
					? `of ${section.displayName} matching the search or filter`
					: `of ${section.displayName}`}
				<Disclosure
					variant="flush"
					sticky
					title={section.displayName}
					meta={narrowed
						? `${section.shown.length} of ${section.tools.length} tools`
						: permissionSummary(section.tools)}
					bind:open={() => isOpen(section.id), (open) => (opened[section.id] = open)}
				>
					{#snippet media()}
						<ServiceLogo name={section.name} src={section.icon} size="xs" />
					{/snippet}
					{#snippet badges()}
						<Mono value={section.namespace} variant="path" />
						{#if section.unverified}<UnverifiedBadge />{/if}
					{/snippet}
					{#snippet actions()}
						<BulkLevelMenu
							{workspace}
							tools={section.shown}
							{subject}
							canSetWorkspaceLevels={data.canSetWorkspaceLevels}
						/>
					{/snippet}
					<ToolGroupList
						items={section.shown}
						annotations={(tool) => tool.annotations}
						key={(tool) => tool.toolId}
						note={groupDefault}
					>
						{#snippet actions(tools, group)}
							<BulkLevelMenu
								{workspace}
								{tools}
								subject={`in “${group.title}” ${subject}`}
								canSetWorkspaceLevels={data.canSetWorkspaceLevels}
							/>
						{/snippet}
						{#snippet row(tool)}
							<ToolPermissionRow
								{workspace}
								{tool}
								canSetWorkspaceLevels={data.canSetWorkspaceLevels}
							/>
						{/snippet}
					</ToolGroupList>
				</Disclosure>
			{:else}
				<EmptyState
					title="No tools match"
					description="Try another search, or set the level filter back to All."
				/>
			{/each}
		{/if}
	</Boundary>
</Page>
