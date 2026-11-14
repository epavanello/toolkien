<script lang="ts">
	import Download from '@lucide/svelte/icons/download';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		Boundary,
		Callout,
		FilterBar,
		Page,
		Timeline,
		type FilterDefinition
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getActivityFilters, watchActivity } from '#lib/functions/activity.remote.ts';
	import { toTimelineItems } from './timeline-items.ts';

	const workspace = $derived(page.params.workspace!);
	let values = $state<Record<string, string>>({ range: '7d' });
	let limit = $state(50);

	const outcomes = ['success', 'failure', 'denied', 'pending'] as const;
	const args = $derived({
		workspace,
		userId: values.userId || undefined,
		connectorId: values.connectorId || undefined,
		outcome: outcomes.find((o) => o === values.outcome),
		range: (values.range || 'all') as '24h' | '7d' | '30d' | '90d' | 'all',
		limit
	});
	const exportHref = $derived(
		`${resolve('/w/[workspace]/activity/export.csv', { workspace })}?${new URLSearchParams(
			Object.entries(args).flatMap(([key, value]) =>
				value && key !== 'workspace' && key !== 'limit' ? [[key, String(value)]] : []
			)
		)}`
	);

	function filtersFor(options: Awaited<ReturnType<typeof getActivityFilters>>): FilterDefinition[] {
		return [
			{
				key: 'range',
				label: 'Period',
				options: [
					{ value: '24h', label: 'Last 24 hours' },
					{ value: '7d', label: 'Last 7 days' },
					{ value: '30d', label: 'Last 30 days' },
					{ value: '90d', label: 'Last 90 days' }
				]
			},
			{ key: 'outcome', label: 'Outcome', options: outcomes.map((o) => ({ value: o, label: o })) },
			...(options.connectors.length
				? [{ key: 'connectorId', label: 'Connector', options: options.connectors }]
				: []),
			...(options.allMembers && options.members.length > 1
				? [{ key: 'userId', label: 'User', options: options.members }]
				: [])
		];
	}
</script>

<Page
	title="Activity"
	description="Who did what and when, grouped by execution. Content is never logged."
>
	<Boundary>
		{@const options = await getActivityFilters(workspace)}
		{@const feed = await watchActivity(args)}
		{#if options.isAdmin && !options.allMembers}
			<Callout
				tone="warning"
				title="You only see your own activity"
				description="Add a passkey to see every member's activity and export it."
			>
				{#snippet action()}
					<Button
						size="sm"
						variant="outline"
						href={resolve('/w/[workspace]/settings/account', { workspace })}
					>
						Account security
					</Button>
				{/snippet}
			</Callout>
		{/if}
		<FilterBar searchable={false} filters={filtersFor(options)} bind:values>
			{#snippet end()}
				{#if options.allMembers}
					<Button
						size="sm"
						variant="outline"
						icon={Download}
						href={exportHref}
						data-sveltekit-reload
					>
						Export CSV
					</Button>
				{/if}
			{/snippet}
		</FilterBar>
		<Timeline
			label="Activity"
			items={toTimelineItems(feed.entries, feed.allMembers)}
			empty={{
				art: 'ledger',
				title: 'No activity in this period',
				description: 'Executions, tool calls, approvals and changes appear here.'
			}}
		>
			{#snippet footer()}
				{#if feed.hasMore}
					<Button size="sm" variant="outline" onclick={() => (limit += 50)}>Load more</Button>
				{/if}
			{/snippet}
		</Timeline>
	</Boundary>
</Page>
