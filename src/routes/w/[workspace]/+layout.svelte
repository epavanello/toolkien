<script lang="ts">
	import AppSidebar from '#lib/components/app/app-sidebar.svelte';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<Sidebar.Provider>
	<AppSidebar workspace={data.workspace} workspaces={data.workspaces} user={data.user} />
	<Sidebar.Inset class="min-w-0">
		<header class="flex h-10 shrink-0 items-center gap-2 border-b px-3 text-sm">
			<Sidebar.Trigger class="-ml-1" />
			<span class="truncate text-muted-foreground">{data.workspace.name}</span>
		</header>
		<main id="main" class="flex flex-1 flex-col">{@render children()}</main>
	</Sidebar.Inset>
</Sidebar.Provider>
