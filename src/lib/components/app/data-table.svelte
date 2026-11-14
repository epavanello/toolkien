<script lang="ts" generics="T">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import Inbox from '@lucide/svelte/icons/inbox';
	import type { Snippet } from 'svelte';
	import { tv } from 'tailwind-variants';
	import { formatDateTime, formatNumber } from '#lib/core/format.ts';
	import { remoteErrorMessage } from '#lib/core/remote-errors.ts';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import ActionsMenu from './actions-menu.svelte';
	import {
		cellValue,
		filterRows,
		groupHeaderAt,
		paginate,
		sortByGroup,
		type Column,
		type TableFilter
	} from './data-table.ts';
	import EmptyState from './empty-state.svelte';
	import FilterBar from './filter-bar.svelte';
	import Mono from './mono.svelte';
	import StatusBadge from './status-badge.svelte';
	import { humanize } from './status.ts';

	/**
	 * The standard list view: dense table with built-in search, select filters, client-side
	 * pagination and loading / error / empty states. Row click (or Enter) calls `onRowClick`,
	 * typically to open a `SidePanel`.
	 */
	type Props = {
		rows: T[] | undefined;
		columns: Column<T>[];
		rowKey: (row: T) => string;
		/** Hide the search box for very short lists */
		searchable?: boolean;
		searchPlaceholder?: string;
		filters?: TableFilter<T>[];
		pageSize?: number;
		loading?: boolean;
		error?: unknown;
		empty?: { title: string; description?: string; action?: Snippet };
		/** Replaces the "No results" state of a search or filter; receives the search text */
		noResults?: Snippet<[string]>;
		/** Extra controls at the right of the filter bar (primary action) */
		toolbar?: Snippet;
		onRowClick?: (row: T) => void;
		/**
		 * Groups rows under a header row (e.g. connector instances by directory server); rows
		 * are sorted by group, keeping their order inside a group. Empty labels go last.
		 */
		group?: (row: T) => string;
		/** Accessible name of the table */
		label: string;
	};

	let {
		rows,
		columns,
		rowKey,
		searchable = true,
		searchPlaceholder = 'Search…',
		filters = [],
		pageSize = 25,
		loading = false,
		error,
		empty = { title: 'Nothing here yet' },
		noResults,
		toolbar,
		onRowClick,
		group,
		label
	}: Props = $props();

	let search = $state('');
	let values = $state<Record<string, string>>({});
	let page = $state(1);

	const filtered = $derived(
		sortByGroup(filterRows(rows ?? [], columns, search, filters, values), group)
	);
	const current = $derived(paginate(filtered, page, pageSize));
	const narrowed = $derived(search.trim() !== '' || Object.values(values).some(Boolean));

	const cellClass = tv({
		base: 'h-9 px-3 py-1.5',
		variants: {
			type: {
				text: '',
				mono: '',
				badge: '',
				status: '',
				datetime: 'text-muted-foreground tabular-nums whitespace-nowrap',
				number: 'text-right tabular-nums',
				actions: 'w-10 text-right'
			},
			hideOnMobile: { true: 'hidden md:table-cell' }
		}
	});

	function handleKey(event: KeyboardEvent, row: T) {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			onRowClick?.(row);
		}
	}
</script>

<div class="flex flex-col gap-2" data-slot="data-table">
	{#if searchable || filters.length > 0 || toolbar}
		<FilterBar
			bind:search={() => search, (value) => ((search = value), (page = 1))}
			bind:values={() => values, (value) => ((values = value), (page = 1))}
			{searchable}
			{searchPlaceholder}
			{filters}
			end={toolbar}
		/>
	{/if}

	<div class="overflow-hidden rounded-lg border bg-card">
		<Table.Root aria-label={label} aria-busy={loading || undefined}>
			<Table.Header class="bg-muted/50">
				<Table.Row>
					{#each columns as column (column.key)}
						<Table.Head
							class={cellClass({ type: column.type ?? 'text', hideOnMobile: column.hideOnMobile })}
						>
							{#if column.type === 'actions'}<span class="sr-only">{column.header}</span
								>{:else}{column.header}{/if}
						</Table.Head>
					{/each}
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#if loading}
					{#each { length: 5 }, index (index)}
						<Table.Row>
							{#each columns as column (column.key)}
								<Table.Cell class={cellClass({ hideOnMobile: column.hideOnMobile })}>
									<Skeleton class="h-4 w-full max-w-40" />
								</Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				{:else if error}
					<Table.Row>
						<Table.Cell colspan={columns.length}>
							<EmptyState title={remoteErrorMessage(error)} />
						</Table.Cell>
					</Table.Row>
				{:else if current.rows.length === 0}
					<Table.Row>
						<Table.Cell colspan={columns.length}>
							{#if narrowed && noResults}
								{@render noResults(search.trim())}
							{:else if narrowed}
								<EmptyState title="No results" description="Try a different search or filter." />
							{:else}
								<EmptyState
									icon={Inbox}
									title={empty.title}
									description={empty.description}
									action={empty.action}
								/>
							{/if}
						</Table.Cell>
					</Table.Row>
				{:else}
					{#each current.rows as row, index (rowKey(row))}
						{@const header = groupHeaderAt(current.rows, index, group)}
						{#if header !== null}
							<Table.Row class="bg-muted/30 hover:bg-muted/30">
								<Table.Cell
									colspan={columns.length}
									class="h-8 px-3 text-xs font-medium text-muted-foreground"
								>
									{header || 'Other'}
								</Table.Cell>
							</Table.Row>
						{/if}
						<Table.Row
							class={onRowClick ? 'cursor-pointer' : ''}
							tabindex={onRowClick ? 0 : undefined}
							onclick={onRowClick ? () => onRowClick(row) : undefined}
							onkeydown={onRowClick ? (event) => handleKey(event, row) : undefined}
						>
							{#each columns as column (column.key)}
								{@const value = cellValue(column, row)}
								{@const inline = column.inlineAction?.(row) ?? null}
								<Table.Cell
									class={cellClass({
										type: column.type ?? 'text',
										hideOnMobile: column.hideOnMobile
									})}
								>
									{#if column.cell}
										{@render column.cell(row)}
									{:else if column.type === 'actions'}
										<!-- Menu clicks must not open the row -->
										<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
										<span onclick={(event) => event.stopPropagation()}>
											<ActionsMenu actions={column.actions?.(row) ?? []} />
										</span>
									{:else if value == null || value === ''}
										<span class="text-muted-foreground">—</span>
									{:else if column.type === 'mono'}
										<Mono value={String(value)} truncate />
									{:else if column.type === 'status'}
										<StatusBadge status={String(value)} />
									{:else if column.type === 'badge'}
										<Badge variant={column.badgeVariant?.(row) ?? 'secondary'} class="rounded-sm">
											{humanize(String(value))}
										</Badge>
									{:else if column.type === 'datetime'}
										{formatDateTime(value as Date)}
									{:else if column.type === 'number'}
										{formatNumber(Number(value))}
									{:else}
										{value}
									{/if}
									{#if inline}
										<!-- The button must not open the row -->
										<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
										<span class="ml-2 inline-block" onclick={(event) => event.stopPropagation()}>
											<Button
												size="xs"
												variant={inline.variant === 'primary' ? 'default' : 'outline'}
												icon={inline.icon}
												onclick={() => inline.onSelect()}>{inline.label}</Button
											>
										</span>
									{/if}
								</Table.Cell>
							{/each}
						</Table.Row>
					{/each}
				{/if}
			</Table.Body>
		</Table.Root>
	</div>

	{#if current.pageCount > 1}
		<nav
			class="flex items-center justify-end gap-2 text-xs text-muted-foreground"
			aria-label="Pagination"
		>
			<span class="tabular-nums">{current.from}–{current.to} of {filtered.length}</span>
			<Button
				variant="outline"
				size="icon-xs"
				icon={ChevronLeft}
				aria-label="Previous page"
				disabled={current.page <= 1}
				onclick={() => (page = current.page - 1)}
			/>
			<Button
				variant="outline"
				size="icon-xs"
				icon={ChevronRight}
				aria-label="Next page"
				disabled={current.page >= current.pageCount}
				onclick={() => (page = current.page + 1)}
			/>
		</nav>
	{/if}
</div>
