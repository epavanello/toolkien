<script lang="ts">
	import { DataTable, Page, type Column } from '#lib/components/app/index.ts';

	// Placeholder (owner: org-ops)
	type Row = { id: string; name: string; email: string; role: string };
	const columns: Column<Row>[] = [
		{ key: 'name', header: 'Name' },
		{ key: 'email', header: 'Email' },
		{ key: 'role', header: 'Role', type: 'badge' }
	];
</script>

<Page title="Members" description="People in this workspace and their roles.">
	<DataTable label="Members" rows={[]} {columns} rowKey={(row) => row.id} />
</Page>
