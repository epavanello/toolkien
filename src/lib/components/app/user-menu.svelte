<script lang="ts">
	import ChevronsUpDown from '@lucide/svelte/icons/chevrons-up-down';
	import LogOut from '@lucide/svelte/icons/log-out';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import Monitor from '@lucide/svelte/icons/monitor';
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { attempt } from '#lib/core/attempt.ts';
	import * as Avatar from '#lib/components/ui/avatar/index.js';
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import { signOut } from '#lib/functions/auth.remote.ts';

	type Props = {
		user: { name: string; email: string; image?: string | null };
		/** Current workspace slug, for the account page link (kept inside the shell) */
		workspace: string;
	};

	let { user, workspace }: Props = $props();

	const sidebar = Sidebar.useSidebar();
	const initials = $derived(
		user.name
			.split(/\s+/)
			.map((part) => part[0])
			.join('')
			.slice(0, 2)
			.toUpperCase()
	);
	const modes = [
		{ value: 'light', label: 'Light', icon: Sun },
		{ value: 'dark', label: 'Dark', icon: Moon },
		{ value: 'system', label: 'System', icon: Monitor }
	] as const;

	async function handleSignOut() {
		if (await attempt(signOut())) await goto(resolve('/(auth)/login'), { invalidateAll: true });
	}
</script>

<Sidebar.Menu>
	<Sidebar.MenuItem>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Sidebar.MenuButton size="lg" aria-label="Account menu" {...props}>
						<Avatar.Root class="size-8 rounded-md">
							{#if user.image}<Avatar.Image src={user.image} alt="" />{/if}
							<Avatar.Fallback class="rounded-md text-xs">{initials}</Avatar.Fallback>
						</Avatar.Root>
						<span class="grid flex-1 text-left leading-tight">
							<span class="truncate font-medium">{user.name}</span>
							<span class="truncate text-xs text-muted-foreground">{user.email}</span>
						</span>
						<ChevronsUpDown class="ml-auto" />
					</Sidebar.MenuButton>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				class="min-w-56"
				align="end"
				side={sidebar.isMobile ? 'bottom' : 'right'}
				sideOffset={4}
			>
				<DropdownMenu.Item>
					{#snippet child({ props })}
						<a href={resolve('/w/[workspace]/settings/account', { workspace })} {...props}>
							<UserCog />
							Account
						</a>
					{/snippet}
				</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Label class="text-xs text-muted-foreground">Theme</DropdownMenu.Label>
				<DropdownMenu.RadioGroup
					value={userPrefersMode.current}
					onValueChange={(value) => setMode(value as (typeof modes)[number]['value'])}
				>
					{#each modes as mode (mode.value)}
						<DropdownMenu.RadioItem value={mode.value}>
							<mode.icon />
							{mode.label}
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onSelect={handleSignOut}>
					<LogOut />
					Sign out
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</Sidebar.MenuItem>
</Sidebar.Menu>
