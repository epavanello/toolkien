<script lang="ts">
	import { tv } from 'tailwind-variants';
	import { Button } from '#lib/components/ui/button/index.js';
	import { attempt } from '#lib/core/attempt.ts';
	import { setToolLevel } from '#lib/functions/permissions.remote.ts';
	import type { PermissionLevel } from '#lib/server/db/schema/workspaces.ts';
	import type { ToolPermission } from '#lib/server/permissions/types.ts';
	import PermissionBadge from './permission-badge.svelte';
	import PermissionSelect from './permission-select.svelte';
	import ToolDefinition, { type ToolDefinitionItem } from './tool-definition.svelte';
	import ToolPath from './tool-path.svelte';

	/**
	 * One tool with its permission: effective level, the viewer's level, the workspace minimum
	 * (admins of company workspaces) and "Confirm" while the level waits for a person. The one
	 * place a tool's level is shown and edited (permissions page, connector panel); saves go
	 * through `setToolLevel`, which refreshes `listPermissions` for every view of it.
	 * With `definition`, the row is a `ToolDefinition` that opens on the TypeScript signature.
	 * Group rows by operation type with `ToolGroupList`.
	 */
	type Props = {
		workspace: string;
		tool: ToolPermission;
		/** Show and edit the workspace minimum (from `listPermissions`) */
		canSetWorkspaceLevels?: boolean;
		definition?: ToolDefinitionItem;
	};

	let { workspace, tool, canSetWorkspaceLevels = false, definition }: Props = $props();

	const styles = tv({
		slots: {
			row: 'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-2 last:border-b-0',
			path: 'flex min-w-0 flex-1 basis-56',
			controls: 'flex flex-wrap items-center gap-x-3 gap-y-1.5',
			effective: 'flex md:w-44',
			field: 'inline-flex items-center gap-1.5',
			label: 'text-xs whitespace-nowrap text-muted-foreground'
		}
	});
	const s = styles();

	const save = (level: PermissionLevel, scope: 'user' | 'workspace') =>
		attempt(setToolLevel({ workspace, toolId: tool.toolId, level, scope }), 'Permission saved');
</script>

{#snippet controls()}
	<span class={s.effective()}>
		<PermissionBadge
			level={tool.effective.level}
			needsConfirmation={tool.effective.needsConfirmation}
		/>
	</span>
	<span class={s.field()}>
		{#if canSetWorkspaceLevels}<span class={s.label()} aria-hidden="true">You</span>{/if}
		<PermissionSelect
			value={tool.chosen}
			floor={tool.floor}
			label={`Your level for ${tool.path}`}
			onchange={(level) => save(level, 'user')}
		/>
	</span>
	{#if canSetWorkspaceLevels}
		<span class={s.field()}>
			<span class={s.label()} aria-hidden="true">Workspace min.</span>
			<PermissionSelect
				value={tool.workspaceLevel}
				label={`Workspace minimum for ${tool.path}`}
				onchange={(level) => save(level, 'workspace')}
			/>
		</span>
	{/if}
	{#if tool.effective.needsConfirmation}
		<Button
			size="xs"
			variant="outline"
			aria-label={`Confirm “${tool.chosen}” for ${tool.path}`}
			onclick={() => save(tool.chosen, 'user')}>Confirm</Button
		>
	{/if}
{/snippet}

{#if definition}
	<ToolDefinition tool={definition} aside={controls} />
{:else}
	<div class={s.row()} data-slot="tool-permission-row">
		<span class={s.path()}><ToolPath path={tool.path} /></span>
		<span class={s.controls()}>{@render controls()}</span>
	</div>
{/if}
