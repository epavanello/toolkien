<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const sectionVariants = tv({
		slots: {
			root: 'flex scroll-mt-14 flex-col',
			header: 'flex flex-wrap items-start justify-between gap-2',
			heading: 'flex min-w-0 items-center gap-3',
			title: 'text-sm font-semibold',
			description: 'text-sm text-muted-foreground',
			body: ''
		},
		variants: {
			/** `card`: bordered box. `plain`: heading + content. `flush`: card whose body has no padding (tables, lists) */
			variant: {
				card: { root: 'rounded-lg border bg-card', header: 'px-4 pt-3', body: 'p-4' },
				plain: { root: 'gap-2' },
				// `overflow-clip`, not `hidden`: clips the corners without becoming a scroll container,
				// so sticky headers inside (`ToolGroupList`) stick to the page or panel scroll
				flush: { root: 'overflow-clip rounded-lg border bg-card', header: 'border-b px-4 py-2.5' }
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
		/** Anchor id, for links to this section (`#setup`) */
		id?: string;
		title?: string;
		description?: string;
		variant?: SectionVariant;
		tone?: SectionTone;
		/** Before the title: a service logo, an avatar */
		media?: Snippet;
		actions?: Snippet;
		children: Snippet;
	};

	let { id, title, description, variant, tone, media, actions, children }: Props = $props();

	const styles = $derived(sectionVariants({ variant, tone }));
</script>

<section {id} class={styles.root()} data-slot="section">
	{#if title || actions}
		<header class={styles.header()}>
			<div class={styles.heading()}>
				{#if media}<div class="shrink-0">{@render media()}</div>{/if}
				<div class="flex min-w-0 flex-col gap-0.5">
					{#if title}<h2 class={styles.title()}>{title}</h2>{/if}
					{#if description}<p class={styles.description()}>{description}</p>{/if}
				</div>
			</div>
			{#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
		</header>
	{/if}
	<div class={styles.body()}>{@render children()}</div>
</section>
