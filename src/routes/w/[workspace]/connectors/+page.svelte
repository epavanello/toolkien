<script lang="ts">
	import { DataTable, Page, type Column } from '#lib/components/app/index.ts';
	import type { ConnectorSummary } from '#lib/server/connectors/types.ts';

	// Placeholder (owner: connectors): replace `rows` with the remote query
	const columns: Column<ConnectorSummary>[] = [
		{ key: 'name', header: 'Name' },
		{ key: 'namespace', header: 'Namespace', type: 'mono' },
		{ key: 'scope', header: 'Scope', type: 'badge' },
		{ key: 'status', header: 'Status', type: 'status' },
		{ key: 'lastSyncedAt', header: 'Last sync', type: 'datetime', hideOnMobile: true }
	];
</script>

<Page title="Connectors" description="Remote MCP servers available in this workspace.">
	<DataTable
		label="Connectors"
		rows={[]}
		{columns}
		rowKey={(row) => row.id}
		empty={{ title: 'No connectors yet', description: 'Add one from the directory or a URL.' }}
	/>
</Page>
