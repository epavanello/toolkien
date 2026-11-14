<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button } from '#lib/components/ui/button/index.js';

	/** Copies `value` to the clipboard and confirms with a check mark for a moment */
	let { value, label = 'Copy' }: { value: string; label?: string } = $props();

	let copied = $state(false);

	async function copy() {
		await navigator.clipboard.writeText(value);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<Button
	variant="ghost"
	size="icon-xs"
	icon={copied ? Check : Copy}
	aria-label={copied ? 'Copied' : label}
	onclick={copy}
/>
