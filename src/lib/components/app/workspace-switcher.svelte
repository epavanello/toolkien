<script lang="ts">
	import Building2 from '@lucide/svelte/icons/building-2';
	import Check from '@lucide/svelte/icons/check';
	import Plus from '@lucide/svelte/icons/plus';
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import User from '@lucide/svelte/icons/user';
	import { resolve } from '$app/paths';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import type { WorkspaceSummary } from '#lib/server/workspaces/types.ts';

	type Props = { current: WorkspaceSummary; workspaces: WorkspaceSummary[] };

	let { current, workspaces }: Props = $props();

	const sidebar = Sidebar.useSidebar();
	const kindLabel = (workspace: WorkspaceSummary) =>
		workspace.kind === 'personal' ? 'Personal' : workspace.role;
</script>

{#snippet icon(workspace: WorkspaceSummary)}
	{#if workspace.kind === 'personal'}<User />{:else}<Building2 />{/if}
{/snippet}

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton
						size="lg"
						class="data-[state=open]:bg-sidebar-accent"
						aria-label="Switch workspace"
						{...props}
					>
						<span
							class="flex size-8 shrink-0 items-center justify-center rounded-md border bg-card text-muted-foreground"
						>
							{@render icon(current)}
						</span>
						<span class="grid flex-1 text-left leading-tight">
							<span class="truncate font-medium">{current.name}</span>
							<span class="truncate text-xs text-muted-foreground capitalize"
								>{kindLabel(current)}</span
							>
						</span>
						<ChevronsUpDown class="ml-auto" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="min-w-56"
				align="start"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				sideOffset={4}
			>
				<DropdownMenu.Label class="text-xs text-muted-foreground">Workspaces</DropdownMenu.Label>
				{#each workspaces as workspace (workspace.id)}
					<DropdownMenu.Item>
						{#snippet child({ props })}
							<a href={resolve('/w/[workspace]', { workspace: workspace.slug })} {...props}>
								{@render icon(workspace)}
								<span class="flex-1 truncate">{workspace.name}</span>
								{#if workspace.id === current.id}<Check class="text-primary" />{/if}
							</a>
						{/snippet}
					</DropdownMenu.Item>
				{/each}
				<DropdownMenu.Separator />
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a
							href="{resolve('/w/[workspace]/settings', { workspace: current.slug })}?new"
							{...props}
						>
							<Plus />
							<span class="flex-1 truncate">New company workspace</span>
						</a>
					{/snippet}
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
