<script lang="ts">
	import { DataTable, Page, type Column } from '#lib/components/app/index.ts';
	import type { DirectoryEntry } from '#lib/server/connectors/types.ts';

	// Placeholder (owner: connectors)
	const columns: Column<DirectoryEntry>[] = [
		{ key: 'name', header: 'Server' },
		{ key: 'description', header: 'Description', hideOnMobile: true },
		{ key: 'authType', header: 'Auth', type: 'badge' }
	];
</script>

<Page title="Directory" description="Curated remote MCP servers with verified annotations.">
	<DataTable label="Directory" rows={[]} {columns} rowKey={(row) => row.id} />
</Page>
