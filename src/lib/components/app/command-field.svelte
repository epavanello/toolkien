<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const commandFieldVariants = tv({
		slots: {
			root: 'flex min-w-0 items-center gap-2 rounded-md border bg-muted/40 py-1.5 pr-1.5 pl-3',
			prefix: 'shrink-0 mono text-xs text-muted-foreground select-none',
			value: 'min-w-0 flex-1 overflow-x-auto py-0.5 text-sm whitespace-nowrap',
			label: 'text-xs font-medium text-muted-foreground'
		},
		variants: {
			/**
			 * `command`: a terminal command (`$` prompt, monospace). `value`: a URL or id to paste.
			 * `prompt`: a sentence to paste in a chat (sans, wraps).
			 */
			variant: {
				command: { value: 'mono' },
				value: { value: 'mono' },
				prompt: {
					root: 'items-start bg-card',
					value: 'overflow-visible font-sans whitespace-normal text-pretty'
				}
			}
		},
		defaultVariants: { variant: 'command' }
	});

	export type CommandFieldVariant = VariantProps<typeof commandFieldVariants>['variant'];
</script>

<script lang="ts">
	import CopyButton from './copy-button.svelte';

	/**
	 * One line to copy (a command, the MCP URL, a sample prompt) with a visible Copy button. For
	 * multi-line code use `CodeBlock`.
	 */
	type Props = { value: string; variant?: CommandFieldVariant; label?: string };

	let { value, variant, label }: Props = $props();

	const styles = $derived(commandFieldVariants({ variant }));
	const copyLabel = $derived(
		variant === 'prompt' ? 'Copy prompt' : variant === 'value' ? 'Copy value' : 'Copy command'
	);
</script>

<div class="flex min-w-0 flex-col gap-1" data-slot="command-field">
	{#if label}<span class={styles.label()}>{label}</span>{/if}
	<div class={styles.root()}>
		{#if variant === undefined || variant === 'command'}
			<span class={styles.prefix()} aria-hidden="true">$</span>
		{/if}
		<code class={styles.value()}>{value}</code>
		<CopyButton {value} label={copyLabel} showLabel variant="outline" />
	</div>
</div>
