<script lang="ts">
	import { DataTable, Page, type Column } from '#lib/components/app/index.ts';
	import type { AuditEvent } from '#lib/server/audit/types.ts';

	// Placeholder (owner: org-ops)
	const columns: Column<AuditEvent>[] = [
		{ key: 'occurredAt', header: 'Time', type: 'datetime' },
		{ key: 'type', header: 'Event', type: 'mono' },
		{ key: 'toolPath', header: 'Tool', type: 'mono', hideOnMobile: true },
		{ key: 'outcome', header: 'Outcome', type: 'status' }
	];
</script>

<Page title="Activity" description="Who did what and when. Content is never logged.">
	<DataTable label="Activity" rows={[]} {columns} rowKey={(row) => row.id} />
</Page>
