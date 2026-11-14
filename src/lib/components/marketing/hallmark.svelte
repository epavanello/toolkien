<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const hallmarkVariants = tv({
		base: 'inline-flex w-fit items-center gap-1.5 chamfer px-2.5 py-1 mono text-[0.6875rem] font-medium tracking-wider uppercase',
		variants: {
			/** `ember` on light sections, `muted` for quiet labels, `ink` on ink bands */
			tone: {
				ember: 'bg-primary/10 text-primary',
				muted: 'bg-muted text-muted-foreground',
				ink: 'bg-foreground/10 text-foreground'
			}
		},
		defaultVariants: { tone: 'ember' }
	});

	export type HallmarkTone = VariantProps<typeof hallmarkVariants>['tone'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The brand's eyebrow label: a chamfered plate in mono caps, like the hallmark struck on
	 * silver. Decorative text only (not interactive: the clip-path would cut a focus ring).
	 */
	let { tone, children }: { tone?: HallmarkTone; children: Snippet } = $props();
</script>

<p class={hallmarkVariants({ tone })} data-slot="hallmark">{@render children()}</p>
