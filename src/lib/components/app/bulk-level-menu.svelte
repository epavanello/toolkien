<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { LEVELS } from '#lib/core/permission-levels.ts';
	import { setToolLevels } from '#lib/functions/permissions.remote.ts';
	import type { ToolPermission } from '#lib/server/permissions/types.ts';
	import ConfirmDialog from './confirm-dialog.svelte';
	import {
		bulkConfirmation,
		bulkItemLabel,
		bulkPlan,
		type BulkPlan,
		type BulkScope
	} from './tool-permission.ts';

	/**
	 * "Set all" of a group of tools (a connector, one operation type of it): the viewer's level,
	 * the workspace minimum (admins of company workspaces) or "Confirm" for the tools to confirm,
	 * for every tool at once. Each choice is planned with `bulkPlan` (tools whose minimum forbids
	 * the level are left out and named), confirmed in a dialog with the count, then saved in one
	 * all-or-nothing `setToolLevels`, which refreshes `listPermissions` for every view.
	 */
	type Props = {
		workspace: string;
		tools: ToolPermission[];
		/** Where the tools are, after "2 tools": "of Dev MCP", "in “Write” of Dev MCP" */
		subject: string;
		canSetWorkspaceLevels?: boolean;
	};

	let { workspace, tools, subject, canSetWorkspaceLevels = false }: Props = $props();

	let pending = $state<BulkPlan | null>(null);
	let confirming = $state(false);

	const scopes = $derived<{ scope: BulkScope; label: string }[]>([
		{ scope: 'user', label: canSetWorkspaceLevels ? 'Your level' : 'Level' },
		...(canSetWorkspaceLevels ? [{ scope: 'workspace' as const, label: 'Workspace minimum' }] : [])
	]);
	const toConfirm = $derived(bulkPlan(tools, 'current', 'user'));
	const confirmation = $derived(pending ? bulkConfirmation(pending, subject) : null);

	function review(plan: BulkPlan) {
		pending = plan;
		confirming = true;
	}

	function apply() {
		if (!pending) return Promise.resolve(false);
		const { tools, level, scope } = pending;
		return attempt(
			setToolLevels({ workspace, toolIds: tools.map((tool) => tool.toolId), level, scope }),
			`Saved for ${tools.length} ${tools.length === 1 ? 'tool' : 'tools'}`
		);
	}
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<Button
				size="xs"
				variant="ghost"
				icon={ChevronDown}
				iconAtEnd
				aria-label={`Set all levels of the tools ${subject}`}
				{...props}>Set all</Button
			>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="min-w-52">
		{#each scopes as { scope, label }, i (scope)}
			{#if i > 0}<DropdownMenu.Separator />{/if}
			<DropdownMenu.Group>
				<DropdownMenu.GroupHeading>
					{label} · {tools.length}
					{tools.length === 1 ? 'tool' : 'tools'}
				</DropdownMenu.GroupHeading>
				{#each LEVELS as level (level)}
					{@const plan = bulkPlan(tools, level, scope)}
					<DropdownMenu.Item disabled={plan.tools.length === 0} onSelect={() => review(plan)}>
						{bulkItemLabel(plan)}
					</DropdownMenu.Item>
				{/each}
			</DropdownMenu.Group>
		{/each}
		{#if toConfirm.tools.length + toConfirm.kept.length > 0}
			<DropdownMenu.Separator />
			<DropdownMenu.Item disabled={toConfirm.tools.length === 0} onSelect={() => review(toConfirm)}>
				Confirm {toConfirm.tools.length} to confirm
			</DropdownMenu.Item>
		{/if}
	</DropdownMenu.Content>
</DropdownMenu.Root>

{#if confirmation}
	<ConfirmDialog
		bind:open={confirming}
		title={confirmation.title}
		description={confirmation.description}
		confirmLabel={confirmation.confirmLabel}
		variant={confirmation.destructive ? 'destructive' : 'default'}
		onConfirm={apply}
	/>
{/if}
