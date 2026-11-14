<script lang="ts">
	import BookOpen from '@lucide/svelte/icons/book-open';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { isActive, workspaceNavigation } from '#lib/navigation.ts';
	import type { WorkspaceSummary } from '#lib/server/workspaces/types.ts';
	import UserMenu from './user-menu.svelte';
	import WelcomeChecklist from './welcome-checklist.svelte';
	import WorkspaceSwitcher from './workspace-switcher.svelte';

	type Props = {
		workspace: WorkspaceSummary;
		workspaces: WorkspaceSummary[];
		user: { name: string; email: string; image?: string | null };
	};

	let { workspace, workspaces, user }: Props = $props();

	const groups = $derived(workspaceNavigation(workspace.slug));
	const connectPage = $derived(resolve('/w/[workspace]/connect', { workspace: workspace.slug }));
</script>

<Sidebar.Root collapsible="icon">
	<Sidebar.Header>
		<WorkspaceSwitcher current={workspace} {workspaces} />
	</Sidebar.Header>
	<Sidebar.Content>
		{#each groups as group (group.title)}
			<Sidebar.Group>
				<Sidebar.GroupLabel>{group.title}</Sidebar.GroupLabel>
				<Sidebar.Menu>
					{#each group.items as item (item.href)}
						{@const active = isActive(page.url.pathname, item.href)}
						<Sidebar.MenuItem>
							<Sidebar.MenuButton isActive={active} tooltipContent={item.title}>
								{#snippet child({ props })}
									<a href={item.href} aria-current={active ? 'page' : undefined} {...props}>
										<item.icon />
										<span>{item.title}</span>
									</a>
								{/snippet}
							</Sidebar.MenuButton>
						</Sidebar.MenuItem>
					{/each}
				</Sidebar.Menu>
			</Sidebar.Group>
		{/each}
	</Sidebar.Content>
	<Sidebar.Footer>
		<!-- The connect page shows the full checklist; elsewhere a compact one (hidden when collapsed) -->
		{#if !isActive(page.url.pathname, connectPage)}
			<div class="group-data-[collapsible=icon]:hidden">
				{#key workspace.slug}
					<WelcomeChecklist workspace={workspace.slug} variant="compact" />
				{/key}
			</div>
		{/if}
		<Sidebar.Menu>
			<Sidebar.MenuItem>
				<Sidebar.MenuButton tooltipContent="Documentation">
					{#snippet child({ props })}
						<a href={resolve('/(marketing)/docs')} {...props}>
							<BookOpen />
							<span>Documentation</span>
						</a>
					{/snippet}
				</Sidebar.MenuButton>
			</Sidebar.MenuItem>
		</Sidebar.Menu>
		<UserMenu {user} workspace={workspace.slug} />
	</Sidebar.Footer>
	<Sidebar.Rail />
</Sidebar.Root>
