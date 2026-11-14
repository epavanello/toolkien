<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const emptyStateVariants = tv({
		slots: {
			root: 'flex flex-col items-center justify-center gap-3 text-center',
			icon: 'flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground',
			title: 'text-sm font-medium text-balance',
			description: 'text-sm text-pretty text-muted-foreground'
		},
		variants: {
			/** `page` fills a section, `inline` sits inside a table or panel */
			variant: {
				page: { root: 'min-h-[40vh] p-8' },
				inline: { root: 'p-6' }
			},
			/** With a brand illustration the title gets the display face (empty lists, first runs) */
			art: { true: { root: 'gap-4', title: 'font-display text-lg font-semibold' } }
		},
		compoundVariants: [{ variant: 'page', art: true, class: { title: 'text-xl' } }],
		defaultVariants: { variant: 'inline', art: false }
	});

	export type EmptyStateVariant = VariantProps<typeof emptyStateVariants>['variant'];
</script>

<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import BrandArt, { type BrandArtName } from '#lib/components/brand/brand-art.svelte';

	type Props = {
		title: string;
		description?: string;
		icon?: Component;
		/**
		 * A brand spot illustration instead of the icon: for empty states with personality (an
		 * empty list the user has not filled yet, a first run). Plain icons stay the default for
		 * "no results" and errors.
		 */
		art?: BrandArtName;
		variant?: EmptyStateVariant;
		/** Call to action, usually one Button */
		action?: Snippet;
	};

	let { title, description, icon: Icon, art, variant, action }: Props = $props();

	const styles = $derived(emptyStateVariants({ variant, art: Boolean(art) }));
</script>

<div class={styles.root()} data-slot="empty-state">
	{#if art}
		<BrandArt name={art} />
	{:else if Icon}
		<span class={styles.icon()}><Icon class="size-4" /></span>
	{/if}
	<div class="flex max-w-sm flex-col gap-1">
		<p class={styles.title()}>{title}</p>
		{#if description}<p class={styles.description()}>{description}</p>{/if}
	</div>
	{#if action}{@render action()}{/if}
</div>
