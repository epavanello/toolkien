<script lang="ts">
	import { DataTable, Page, type Column } from '#lib/components/app/index.ts';

	// Placeholder (owner: execution)
	type Row = { toolId: string; path: string; connector: string; level: string };
	const columns: Column<Row>[] = [
		{ key: 'path', header: 'Tool', type: 'mono' },
		{ key: 'connector', header: 'Connector' },
		{ key: 'level', header: 'Level', type: 'badge' }
	];
</script>

<Page title="Permissions" description="Choose which tools run freely, ask first, or are blocked.">
	<DataTable label="Tool permissions" rows={[]} {columns} rowKey={(row) => row.toolId} />
</Page>
