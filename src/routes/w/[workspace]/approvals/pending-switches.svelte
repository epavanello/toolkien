<script lang="ts">
	import { resolve } from '$app/paths';
	import { DataTable, Section, type Column } from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PendingSwitchRow } from '#lib/server/mcp/types.ts';

	/**
	 * Workspace switches from or to this workspace waiting for the viewer: deciding happens on
	 * `/consent?switch=<id>`, the same page the agent's link opens. Hidden when there are none.
	 */
	let { rows }: { rows: PendingSwitchRow[] } = $props();

	const reviewHref = (row: PendingSwitchRow) =>
		`${resolve('/(auth)/consent')}?switch=${encodeURIComponent(row.id)}`;

	const columns: Column<PendingSwitchRow>[] = [
		{ key: 'client', header: 'Client' },
		{ key: 'from', header: 'From', hideOnMobile: true },
		{ key: 'to', header: 'To' },
		{ key: 'expiresAt', header: 'Expires', type: 'datetime', hideOnMobile: true },
		{ key: 'review', header: 'Decision', cell: review }
	];
</script>

{#snippet review(row: PendingSwitchRow)}
	<Button size="xs" href={reviewHref(row)} aria-label="Review the switch to {row.to}">
		Review
	</Button>
{/snippet}

{#if rows.length > 0}
	<Section
		title="Workspace switches"
		description="MCP clients asking to switch workspace. Confirm here if the dialog in the client timed out."
		variant="plain"
	>
		<DataTable
			label="Pending workspace switches"
			{rows}
			{columns}
			rowKey={(row) => row.id}
			searchable={false}
		/>
	</Section>
{/if}
