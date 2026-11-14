<script lang="ts">
	import { page } from '$app/state';
	import {
		Boundary,
		DataTable,
		Page,
		PermissionBadge,
		PermissionSelect,
		ToolPath,
		type Column,
		type TableFilter
	} from '#lib/components/app/index.ts';
	import { attempt } from '#lib/core/attempt.ts';
	import { listPermissions, setToolLevel } from '#lib/functions/permissions.remote.ts';
	import type { ToolPermission } from '#lib/server/permissions/types.ts';
	import type { PermissionLevel } from '#lib/server/db/schema/workspaces.ts';

	const workspace = $derived(page.params.workspace!);

	const save = (row: ToolPermission, level: PermissionLevel, scope: 'user' | 'workspace') =>
		attempt(setToolLevel({ workspace, toolId: row.toolId, level, scope }), 'Permission saved');

	const userColumns: Column<ToolPermission>[] = [
		{ key: 'path', header: 'Tool', type: 'mono', cell: toolCell },
		{ key: 'connectorName', header: 'Connector', hideOnMobile: true },
		{ key: 'effective', header: 'Effective', cell: effectiveCell, searchable: false },
		{ key: 'chosen', header: 'Your level', cell: levelCell, searchable: false },
		{
			key: 'actions',
			header: 'Actions',
			type: 'actions',
			actions: (row) => [
				{
					label: `Confirm “${row.chosen}”`,
					hidden: !row.effective.needsConfirmation,
					onSelect: () => save(row, row.chosen, 'user')
				}
			]
		}
	];
	const workspaceColumn: Column<ToolPermission> = {
		key: 'workspaceLevel',
		header: 'Workspace minimum',
		cell: workspaceCell,
		searchable: false,
		hideOnMobile: true
	};

	const filters: TableFilter<ToolPermission>[] = [
		{
			key: 'level',
			label: 'Level',
			options: [
				{ value: 'allow', label: 'Always allow' },
				{ value: 'ask', label: 'Ask' },
				{ value: 'block', label: 'Blocked' },
				{ value: 'confirm', label: 'To confirm' }
			],
			match: (row, value) =>
				value === 'confirm' ? row.effective.needsConfirmation : row.effective.level === value
		}
	];
</script>

{#snippet toolCell(row: ToolPermission)}
	<ToolPath path={row.path} unverified={row.unverified} />
{/snippet}

{#snippet effectiveCell(row: ToolPermission)}
	<PermissionBadge
		level={row.effective.level}
		needsConfirmation={row.effective.needsConfirmation}
	/>
{/snippet}

{#snippet levelCell(row: ToolPermission)}
	<PermissionSelect
		value={row.chosen}
		floor={row.floor}
		label={`Your level for ${row.path}`}
		onchange={(level) => save(row, level, 'user')}
	/>
{/snippet}

{#snippet workspaceCell(row: ToolPermission)}
	<PermissionSelect
		value={row.workspaceLevel}
		label={`Workspace minimum for ${row.path}`}
		onchange={(level) => save(row, level, 'workspace')}
	/>
{/snippet}

<Page
	title="Permissions"
	description="Choose which tools run freely, ask you first, or are blocked. Blocked tools are hidden from agents; every call is checked again when it runs."
>
	<Boundary>
		{@const data = await listPermissions(workspace)}
		<DataTable
			label="Tool permissions"
			rows={data.tools}
			columns={data.canSetWorkspaceLevels
				? [...userColumns.slice(0, 4), workspaceColumn, userColumns[4]]
				: userColumns}
			{filters}
			rowKey={(row) => row.toolId}
			searchPlaceholder="Search tools…"
			empty={{
				title: 'No tools yet',
				description: 'Add a connector: its tools show up here with their default levels.'
			}}
		/>
	</Boundary>
</Page>
