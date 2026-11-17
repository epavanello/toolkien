<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import CheckCheck from '@lucide/svelte/icons/check-check';
	import X from '@lucide/svelte/icons/x';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import {
		ArgumentsPreview,
		Boundary,
		CodeBlock,
		EmptyState,
		KeyValueList,
		Page,
		Section,
		Toolbar
	} from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { decide, watchApproval } from '#lib/functions/executions.remote.ts';

	const approvalId = $derived(page.params.id!);

	const answer = (choice: 'approve_once' | 'approve_tool' | 'reject') =>
		attempt(
			decide({ approvalId, choice }),
			choice === 'reject' ? 'Call rejected' : 'Call approved'
		);
</script>

<Page
	variant="narrow"
	title="Approve a tool call"
	description="A script run by your agent is paused until you decide. Only you (or a workspace admin) can answer: never the agent."
	back={{ href: resolve('/approve'), label: 'Pending approvals' }}
>
	<Boundary>
		{@const view = await watchApproval(approvalId)}
		<Section title="Request">
			<KeyValueList
				items={[
					{ label: 'Workspace', value: view.workspaceName },
					{ label: 'Connector', value: view.connectorName },
					{ label: 'Tool', value: view.toolPath, type: 'mono' },
					{ label: 'Approval', value: view.status, type: 'status' },
					{ label: 'Execution', value: view.executionStatus, type: 'status' },
					{ label: 'Expires', value: view.expiresAt, type: 'datetime' }
				]}
			/>
		</Section>

		{#if view.canDecide}
			{#if view.argumentsFields}
				<ArgumentsPreview value={view.argumentsFields} />
			{:else}
				<CodeBlock
					label="Main arguments"
					lang="text"
					code={view.argumentsPreview || '(no arguments)'}
				/>
			{/if}
			{#if view.onBehalfOfOtherUser}
				<EmptyState
					title="You are answering as a workspace admin"
					description="This request comes from another member's agent."
				/>
			{/if}
			<Toolbar>
				<Button icon={Check} onclick={() => answer('approve_once')}>Approve only this call</Button>
				<Button variant="outline" icon={CheckCheck} onclick={() => answer('approve_tool')}>
					Approve all calls to this tool in this script
				</Button>
				{#snippet end()}
					<Button variant="destructive" icon={X} onclick={() => answer('reject')}>Reject</Button>
				{/snippet}
			</Toolbar>
		{:else if view.status === 'approved' || view.status === 'rejected'}
			<EmptyState
				title={view.status === 'approved' ? 'Approved' : 'Rejected'}
				description="Go back to your agent: the script continues when it checks the execution status."
			/>
		{:else}
			<EmptyState
				title="This request can no longer be answered"
				description="It expired or the execution ended. Ask your agent to run the script again."
			/>
		{/if}
	</Boundary>
</Page>
