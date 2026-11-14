<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const sectionVariants = tv({
		slots: {
			root: 'flex flex-col',
			header: 'flex flex-wrap items-start justify-between gap-2',
			title: 'text-sm font-semibold',
			description: 'text-sm text-muted-foreground',
			body: ''
		},
		variants: {
			/** `card`: bordered box. `plain`: heading + content. `flush`: card whose body has no padding (tables, lists) */
			variant: {
				card: { root: 'rounded-lg border bg-card', header: 'px-4 pt-3', body: 'p-4' },
				plain: { root: 'gap-2' },
				flush: { root: 'overflow-hidden rounded-lg border bg-card', header: 'border-b px-4 py-2.5' }
			},
			/** `danger` frames destructive settings (delete workspace) */
			tone: { default: '', danger: { root: 'border-destructive/40', title: 'text-destructive' } }
		},
		defaultVariants: { variant: 'card', tone: 'default' }
	});

	export type SectionVariant = VariantProps<typeof sectionVariants>['variant'];
	export type SectionTone = VariantProps<typeof sectionVariants>['tone'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	type Props = {
		title?: string;
		description?: string;
		variant?: SectionVariant;
		tone?: SectionTone;
		actions?: Snippet;
		children: Snippet;
	};

	let { title, description, variant, tone, actions, children }: Props = $props();

	const styles = $derived(sectionVariants({ variant, tone }));
</script>

<section class={styles.root()} data-slot="section">
	{#if title || actions}
		<header class={styles.header()}>
			<div class="flex flex-col gap-0.5">
				{#if title}<h2 class={styles.title()}>{title}</h2>{/if}
				{#if description}<p class={styles.description()}>{description}</p>{/if}
			</div>
			{#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class={styles.body()}>{@render children()}</div>
</section>
