<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { DataTable, type Column } from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { PendingApprovalRow } from '#lib/server/executions/types.ts';

	/**
	 * The viewer's pending approvals in a workspace. Deciding happens on the approval page
	 * (`/approve/<id>`), the same one the agent's link opens: this list only points there.
	 */
	let { rows }: { rows: PendingApprovalRow[] } = $props();

	const reviewHref = (row: PendingApprovalRow) => resolve('/approve/[id]', { id: row.approvalId });

	const columns: Column<PendingApprovalRow>[] = [
		{ key: 'toolPath', header: 'Tool', type: 'mono' },
		{ key: 'connectorName', header: 'Connector', logo: (row) => row.connectorIcon },
		{ key: 'argumentsPreview', header: 'Arguments', type: 'mono', hideOnMobile: true },
		{ key: 'client', header: 'Client', hideOnMobile: true },
		{ key: 'createdAt', header: 'Requested', type: 'datetime', hideOnMobile: true },
		{ key: 'expiresAt', header: 'Expires', type: 'datetime' },
		{ key: 'review', header: 'Decision', cell: review }
	];
</script>

{#snippet review(row: PendingApprovalRow)}
	<Button size="xs" href={reviewHref(row)} aria-label="Review the call to {row.toolPath}">
		Review
	</Button>
{/snippet}

<DataTable
	label="Pending approvals"
	{rows}
	{columns}
	rowKey={(row) => row.approvalId}
	searchable={false}
	empty={{
		art: 'seal',
		title: 'Nothing to approve',
		description:
			'When a script in this workspace needs your approval, it shows up here live, with a link to decide.'
	}}
	onRowClick={(row) => goto(reviewHref(row))}
/>
