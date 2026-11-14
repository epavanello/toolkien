<script lang="ts">
	import Ban from '@lucide/svelte/icons/ban';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import CircleHelp from '@lucide/svelte/icons/circle-help';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import type { PermissionLevel } from '#lib/server/db/schema/workspaces.ts';

	/** Permission level of a tool; `needsConfirmation` marks a level to re-confirm */
	type Props = { level: PermissionLevel; needsConfirmation?: boolean };

	let { level, needsConfirmation = false }: Props = $props();

	const config = {
		allow: { label: 'Always allow', variant: 'success', icon: CircleCheck },
		ask: { label: 'Ask', variant: 'warning', icon: CircleHelp },
		block: { label: 'Blocked', variant: 'destructive', icon: Ban }
	} as const;

	const current = $derived(config[level]);
</script>

<Badge variant={current.variant} class="rounded-sm">
	<current.icon data-icon="inline-start" />
	{current.label}{needsConfirmation ? ' · to confirm' : ''}
</Badge>
