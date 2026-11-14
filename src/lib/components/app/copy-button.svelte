<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Copy from '@lucide/svelte/icons/copy';
	import { Button, type ButtonVariant } from '#lib/components/ui/button/index.js';

	/**
	 * Copies `value` to the clipboard and confirms with a check mark for a moment. Icon-only by
	 * default; `showLabel` adds a visible "Copy" / "Copied" text (onboarding, primary commands).
	 */
	type Props = { value: string; label?: string; showLabel?: boolean; variant?: ButtonVariant };

	let { value, label = 'Copy', showLabel = false, variant = 'ghost' }: Props = $props();

	let copied = $state(false);

	async function copy() {
		await navigator.clipboard.writeText(value);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

{#if showLabel}
	<Button {variant} size="xs" icon={copied ? Check : Copy} aria-label={label} onclick={copy}>
		{copied ? 'Copied' : 'Copy'}
	</Button>
{:else}
	<Button
		{variant}
		size="icon-xs"
		icon={copied ? Check : Copy}
		aria-label={copied ? 'Copied' : label}
		onclick={copy}
	/>
{/if}
