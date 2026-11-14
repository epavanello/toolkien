<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const marketingSectionVariants = tv({
		slots: {
			root: 'border-b',
			inner: 'mx-auto flex max-w-6xl flex-col gap-8 px-4 py-14 sm:px-6',
			header: 'flex max-w-2xl flex-col gap-2',
			eyebrow: 'text-sm font-medium text-primary',
			title: 'text-2xl font-semibold tracking-tight text-balance',
			description: 'text-pretty text-muted-foreground'
		},
		variants: {
			/** `muted` alternates the background between sections */
			tone: { default: {}, muted: { root: 'bg-muted/30' } }
		},
		defaultVariants: { tone: 'default' }
	});

	export type MarketingSectionTone = VariantProps<typeof marketingSectionVariants>['tone'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';

	/** A band of the landing page: heading block then content */
	type Props = {
		id?: string;
		eyebrow?: string;
		title: string;
		description?: string;
		tone?: MarketingSectionTone;
		children: Snippet;
	};

	let { id, eyebrow, title, description, tone, children }: Props = $props();

	const styles = $derived(marketingSectionVariants({ tone }));
	const headingId = $props.id();
</script>

<section {id} class={styles.root()} aria-labelledby={headingId} data-slot="marketing-section">
	<div class={styles.inner()}>
		<header class={styles.header()}>
			{#if eyebrow}<p class={styles.eyebrow()}>{eyebrow}</p>{/if}
			<h2 id={headingId} class={styles.title()}>{title}</h2>
			{#if description}<p class={styles.description()}>{description}</p>{/if}
		</header>
		{@render children()}
	</div>
</section>
