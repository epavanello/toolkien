<script lang="ts">
	import Lock from '@lucide/svelte/icons/lock';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import { LEVELS, satisfiesFloor } from '#lib/core/permission-levels.ts';
	import type { PermissionLevel } from '#lib/server/db/schema/workspaces.ts';
	import { LEVEL_LABELS as LABELS } from './tool-permission.ts';

	/**
	 * Level selector of one tool. Options looser than `floor` (workspace policy) are disabled and
	 * a lock explains why. `onchange` returns whether the change was saved (e.g. `attempt(...)`);
	 * on failure the select goes back to `value`. `value: null` shows "Not set".
	 */
	type Props = {
		value: PermissionLevel | null;
		/** Accessible name, e.g. "Your level for github.createIssue" */
		label: string;
		floor?: PermissionLevel;
		/** Who set the floor, for the lock tooltip */
		floorLabel?: string;
		disabled?: boolean;
		onchange: (level: PermissionLevel) => Promise<boolean> | boolean;
	};

	let {
		value,
		label,
		floor = 'allow',
		floorLabel = 'Workspace policy',
		disabled = false,
		onchange
	}: Props = $props();

	let saving = $state(false);

	async function handleChange(event: Event & { currentTarget: HTMLSelectElement }) {
		const select = event.currentTarget;
		saving = true;
		const saved = await onchange(select.value as PermissionLevel);
		saving = false;
		if (!saved) select.value = value ?? '';
	}
</script>

<span class="inline-flex items-center gap-1.5" data-slot="permission-select">
	<NativeSelect.Root
		size="sm"
		value={value ?? ''}
		aria-label={label}
		disabled={disabled || saving}
		onchange={handleChange}
	>
		{#if value === null}<NativeSelect.Option value="" disabled>Not set</NativeSelect.Option>{/if}
		{#each LEVELS as level (level)}
			<NativeSelect.Option value={level} disabled={!satisfiesFloor(level, floor)}>
				{LABELS[level]}
			</NativeSelect.Option>
		{/each}
	</NativeSelect.Root>
	{#if floor !== 'allow'}
		<Tooltip.Root>
			<Tooltip.Trigger>
				{#snippet child({ props })}
					<button
						type="button"
						class="text-muted-foreground"
						aria-label={`${floorLabel}: at least ${LABELS[floor]}`}
						{...props}
					>
						<Lock class="size-3.5" />
					</button>
				{/snippet}
			</Tooltip.Trigger>
			<Tooltip.Content>{floorLabel}: at least “{LABELS[floor]}”.</Tooltip.Content>
		</Tooltip.Root>
	{/if}
</span>
