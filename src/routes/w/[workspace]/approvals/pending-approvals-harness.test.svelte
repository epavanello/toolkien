<script lang="ts">
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import type { PendingApprovalRow } from '#lib/server/executions/types.ts';
	import PendingApprovals from './pending-approvals.svelte';

	/** Test harness: the app layout's tooltip provider around the list */
	let { rows }: { rows: PendingApprovalRow[] } = $props();
</script>

<Tooltip.Provider><PendingApprovals {rows} /></Tooltip.Provider>
