import type { Component } from 'svelte';
import Activity from '@lucide/svelte/icons/activity';
import LibraryBig from '@lucide/svelte/icons/library-big';
import Plug from '@lucide/svelte/icons/plug';
import Settings from '@lucide/svelte/icons/settings';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import Users from '@lucide/svelte/icons/users';
import { resolve } from '$app/paths';

export type NavItem = { title: string; href: string; icon: Component };
export type NavGroup = { title: string; items: NavItem[] };

/**
 * The workspace navigation, single source for the sidebar. Every section lives under
 * `/w/[workspace]/<section>`; add new sections here, never in a component.
 */
export function workspaceNavigation(workspace: string): NavGroup[] {
	return [
		{
			title: 'Tools',
			items: [
				{
					title: 'Connectors',
					href: resolve('/w/[workspace]/connectors', { workspace }),
					icon: Plug
				},
				{
					title: 'Directory',
					href: resolve('/w/[workspace]/directory', { workspace }),
					icon: LibraryBig
				},
				{
					title: 'Permissions',
					href: resolve('/w/[workspace]/permissions', { workspace }),
					icon: ShieldCheck
				}
			]
		},
		{
			title: 'Workspace',
			items: [
				{
					title: 'Activity',
					href: resolve('/w/[workspace]/activity', { workspace }),
					icon: Activity
				},
				{ title: 'Members', href: resolve('/w/[workspace]/members', { workspace }), icon: Users },
				{
					title: 'Settings',
					href: resolve('/w/[workspace]/settings', { workspace }),
					icon: Settings
				}
			]
		}
	];
}

/** A section is active on its own page and on its detail pages */
export const isActive = (pathname: string, href: string) =>
	pathname === href || pathname.startsWith(`${href}/`);
