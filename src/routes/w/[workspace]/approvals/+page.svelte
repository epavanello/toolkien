<script lang="ts">
	import { page } from '$app/state';
	import { Boundary, Page } from '#lib/components/app/index.ts';
	import { watchWorkspaceApprovals } from '#lib/functions/executions.remote.ts';
	import PendingApprovals from './pending-approvals.svelte';

	const workspace = $derived(page.params.workspace!);
</script>

<Page
	title="Pending approvals"
	description="Tool calls your agents are waiting on in this workspace. Only you can answer them, never the agent; unanswered requests expire after 30 minutes."
>
	<Boundary>
		<PendingApprovals rows={await watchWorkspaceApprovals(workspace)} />
	</Boundary>
</Page>
