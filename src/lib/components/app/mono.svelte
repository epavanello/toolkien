<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const monoVariants = tv({
		base: 'mono inline-flex min-w-0 items-center gap-1',
		variants: {
			/** `id` dims long identifiers; `path` is a tool path like `github.createIssue` */
			variant: { default: '', id: 'text-muted-foreground', path: 'text-foreground font-medium' },
			truncate: { true: '[&>span]:truncate' }
		},
		defaultVariants: { variant: 'default' }
	});

	export type MonoVariant = VariantProps<typeof monoVariants>['variant'];
</script>

<script lang="ts">
	import CopyButton from './copy-button.svelte';

	/** IDs, tool paths and short code in monospace, optionally copyable */
	type Props = { value: string; variant?: MonoVariant; copy?: boolean; truncate?: boolean };

	let { value, variant, copy = false, truncate = false }: Props = $props();
</script>

<span class={monoVariants({ variant, truncate })} title={truncate ? value : undefined}>
	<span>{value}</span>
	{#if copy}<CopyButton {value} />{/if}
</span>
