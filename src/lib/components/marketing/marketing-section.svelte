<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const marketingSectionVariants = tv({
		slots: {
			root: 'border-b',
			inner: 'mx-auto flex max-w-6xl flex-col gap-10 px-4 py-16 sm:px-6 lg:py-20',
			header: 'flex max-w-2xl flex-col gap-3',
			title:
				'font-display text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl',
			description: 'text-lg text-pretty text-muted-foreground'
		},
		variants: {
			/**
			 * `muted` alternates the background between sections; `ink` is the dark forge band (dark
			 * tokens in both themes) for the closing call to action.
			 */
			tone: {
				default: {},
				muted: { root: 'bg-muted/40' },
				ink: { root: 'dark border-b-0 bg-ink text-foreground' }
			},
			/** `center` for short closing bands */
			align: {
				start: {},
				center: { inner: 'items-center text-center', header: 'items-center' }
			}
		},
		defaultVariants: { tone: 'default', align: 'start' }
	});

	export type MarketingSectionTone = VariantProps<typeof marketingSectionVariants>['tone'];
	export type MarketingSectionAlign = VariantProps<typeof marketingSectionVariants>['align'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import Hallmark from './hallmark.svelte';

	/** A band of the landing page: heading block then content */
	type Props = {
		id?: string;
		eyebrow?: string;
		title: string;
		description?: string;
		tone?: MarketingSectionTone;
		align?: MarketingSectionAlign;
		children: Snippet;
	};

	let { id, eyebrow, title, description, tone, align, children }: Props = $props();

	const styles = $derived(marketingSectionVariants({ tone, align }));
	const headingId = $props.id();
</script>

<section {id} class={styles.root()} aria-labelledby={headingId} data-slot="marketing-section">
	<div class={styles.inner()}>
		<header class={styles.header()}>
			{#if eyebrow}<Hallmark tone={tone === 'ink' ? 'ink' : 'ember'}>{eyebrow}</Hallmark>{/if}
			<h2 id={headingId} class={styles.title()}>{title}</h2>
			{#if description}<p class={styles.description()}>{description}</p>{/if}
		</header>
		{@render children()}
	</div>
</section>
