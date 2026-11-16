<script lang="ts">
	import { page } from '$app/state';
	import { Boundary, Page } from '#lib/components/app/index.ts';
	import {
		watchWorkspaceApprovals,
		watchWorkspaceSwitches
	} from '#lib/functions/executions.remote.ts';
	import PendingApprovals from './pending-approvals.svelte';
	import PendingSwitches from './pending-switches.svelte';

	const workspace = $derived(page.params.workspace!);
</script>

<Page
	title="Pending approvals"
	description="Tool calls and workspace switches your agents are waiting on in this workspace. Only you can answer them, never the agent; unanswered tool calls expire after 30 minutes, switches after 10."
>
	<Boundary>
		<PendingSwitches rows={await watchWorkspaceSwitches(workspace)} />
	</Boundary>
	<Boundary>
		<PendingApprovals rows={await watchWorkspaceApprovals(workspace)} />
	</Boundary>
</Page>
