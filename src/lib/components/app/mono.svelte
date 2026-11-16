<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const monoVariants = tv({
		base: 'mono inline-flex min-w-0 items-center gap-1',
		variants: {
			/** `id` dims long identifiers; `path` is a tool path like `github.createIssue` */
			variant: { default: '', id: 'text-muted-foreground', path: 'text-foreground font-medium' },
			truncate: { true: 'max-w-full [&>span]:truncate' },
			/** A boxed, full-width code field (URLs, paths) with the copy button inside */
			field: {
				true: 'flex w-full justify-between rounded-md border bg-muted/50 py-0.5 ps-2 pe-0.5 text-xs'
			}
		},
		defaultVariants: { variant: 'default' }
	});

	export type MonoVariant = VariantProps<typeof monoVariants>['variant'];
</script>

<script lang="ts">
	import CopyButton from './copy-button.svelte';

	/** IDs, tool paths and short code in monospace, optionally copyable */
	type Props = {
		value: string;
		variant?: MonoVariant;
		copy?: boolean;
		truncate?: boolean;
		field?: boolean;
	};

	let { value, variant, copy = false, truncate = false, field = false }: Props = $props();
</script>

<span
	class={monoVariants({ variant, truncate, field: field && copy })}
	title={truncate ? value : undefined}
>
	<span class="min-w-0">{value}</span>
	{#if copy}<CopyButton {value} />{/if}
</span>
