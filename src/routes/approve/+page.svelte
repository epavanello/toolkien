<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Boundary, DataTable, Page, type Column } from '#lib/components/app/index.ts';
	import { watchPendingApprovals } from '#lib/functions/executions.remote.ts';

	type Row = Awaited<ReturnType<typeof watchPendingApprovals>>[number];

	const columns: Column<Row>[] = [
		{ key: 'toolPath', header: 'Tool', type: 'mono' },
		{ key: 'connectorName', header: 'Connector', hideOnMobile: true },
		{ key: 'workspaceName', header: 'Workspace' },
		{ key: 'expiresAt', header: 'Expires', type: 'datetime', hideOnMobile: true }
	];
</script>

<Page
	variant="detail"
	title="Pending approvals"
	description="Tool calls your agents are waiting on. Unanswered requests expire after 30 minutes."
>
	<Boundary>
		<DataTable
			label="Pending approvals"
			rows={await watchPendingApprovals()}
			{columns}
			rowKey={(row) => row.approvalId}
			searchable={false}
			empty={{
				art: 'seal',
				title: 'Nothing to approve',
				description: 'All quiet at the gate. New requests appear here live.'
			}}
			onRowClick={(row) => goto(resolve('/approve/[id]', { id: row.approvalId }))}
		/>
	</Boundary>
</Page>
