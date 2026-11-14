<script lang="ts">
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';

	type Props = {
		open?: boolean;
		title: string;
		description: string;
		confirmLabel: string;
		/** `destructive` (default) for deletions and revocations */
		variant?: 'default' | 'destructive';
		/** The dialog closes once this resolves to true (usually `attempt(...)`) */
		onConfirm: () => Promise<boolean>;
	};

	let {
		open = $bindable(false),
		title,
		description,
		confirmLabel,
		variant = 'destructive',
		onConfirm
	}: Props = $props();

	async function handleConfirm() {
		if (await onConfirm()) open = false;
	}
</script>

<AlertDialog.Root bind:open>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>{title}</AlertDialog.Title>
			<AlertDialog.Description>{description}</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<Button {variant} onclick={handleConfirm}>{confirmLabel}</Button>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
