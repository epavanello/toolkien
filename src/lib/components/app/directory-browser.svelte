<script lang="ts" generics="T extends DirectoryEntry">
	import type { Snippet } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { DirectoryEntry } from '#lib/server/connectors/types.ts';
	import CategoryFilter from './category-filter.svelte';
	import FilterBar from './filter-bar.svelte';
	import ServiceCard from './service-card.svelte';
	import ServiceDetails from './service-details.svelte';
	import ServiceLogo from './service-logo.svelte';
	import SidePanel from './side-panel.svelte';
	import SourceBadge from './source-badge.svelte';
	import { categoryLabel, directoryFilters, filterDirectory } from './service-directory.ts';

	/**
	 * The server directory as a browsable catalogue (in-app and public pages): search, category
	 * chips ("All", "Popular", categories), a card grid, and a details panel. Pages only pass the
	 * entries and what "Add" does: `cardAction` (on each card) and `panelAction` (primary action
	 * in the details).
	 */
	type Props = {
		entries: T[];
		label?: string;
		/** Entry already in the workspace (shows "Added") */
		added?: (entry: T) => boolean;
		/** A button on each card that opens the details (where the real action is) */
		cardButton?: string;
		cardAction?: Snippet<[T]>;
		panelAction?: Snippet<[T]>;
		/** Shown when nothing matches; receives the search text */
		noResults?: Snippet<[string]>;
	};

	let {
		entries,
		label = 'Directory',
		added = () => false,
		cardButton,
		cardAction,
		panelAction,
		noResults
	}: Props = $props();

	let search = $state('');
	let filter = $state('');
	let selected = $state<T | null>(null);
	let open = $state(false);

	const chips = $derived(directoryFilters(entries));
	const show = (entry: T) => {
		selected = entry;
		open = true;
	};
	const visible = $derived(filterDirectory(entries, { search, filter }));
</script>

<div class="flex flex-col gap-4" data-slot="directory-browser">
	<div class="flex flex-col gap-3">
		<FilterBar bind:search searchPlaceholder={`Search ${entries.length} tools…`} />
		<CategoryFilter label="Category" options={chips} bind:value={filter} />
	</div>

	<p class="sr-only" aria-live="polite">{visible.length} tools shown</p>

	{#if visible.length > 0}
		<ul class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label={label}>
			{#each visible as entry (entry.id)}
				<li class="min-w-0">
					<ServiceCard
						name={entry.name}
						icon={entry.icon}
						tagline={entry.tagline}
						description={entry.description}
						publisher={entry.publisher}
						needsReview={entry.verification.status === 'needs-review'}
						reviewNote={entry.verification.notes}
						category={categoryLabel(entry.category)}
						authType={entry.authType}
						added={added(entry)}
						onSelect={() => show(entry)}
					>
						{#snippet action()}
							{#if !entry.supported}
								<span class="text-xs text-muted-foreground">Not available yet</span>
							{:else if cardAction}
								{@render cardAction(entry)}
							{:else if cardButton}
								<Button
									size="sm"
									variant="outline"
									onclick={() => show(entry)}
									aria-label={`${cardButton} ${entry.name}`}>{cardButton}</Button
								>
							{/if}
						{/snippet}
					</ServiceCard>
				</li>
			{/each}
		</ul>
	{:else if noResults}
		{@render noResults(search)}
	{/if}
</div>

{#if selected}
	{@const entry = selected}
	<SidePanel bind:open title={entry.name} description={entry.tagline} size="md">
		{#snippet media()}
			<ServiceLogo name={entry.name} src={entry.icon} size="md" />
		{/snippet}
		{#snippet meta()}
			<SourceBadge
				publisher={entry.publisher}
				service={entry.name}
				needsReview={entry.verification.status === 'needs-review'}
				reviewNote={entry.verification.notes}
				tooltips={false}
			/>
		{/snippet}
		<ServiceDetails {entry}>
			{#snippet action()}
				{#if panelAction}{@render panelAction(entry)}{/if}
			{/snippet}
		</ServiceDetails>
	</SidePanel>
{/if}
