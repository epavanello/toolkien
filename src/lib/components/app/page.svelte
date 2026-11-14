<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const pageVariants = tv({
		slots: {
			root: 'mx-auto flex w-full flex-col gap-4 px-4 py-4 md:px-6',
			header: 'flex flex-wrap items-start justify-between gap-3 border-b pb-3',
			title: 'text-lg leading-7 font-semibold tracking-tight',
			description: 'max-w-3xl text-sm text-pretty text-muted-foreground',
			body: 'flex flex-col gap-4'
		},
		variants: {
			/**
			 * `list`: full width, a table is the main content. `detail`: one entity with sections.
			 * `form`: settings and long forms. `narrow`: a single focused task (approve, invite).
			 */
			variant: {
				list: { root: 'max-w-none' },
				detail: { root: 'max-w-6xl' },
				form: { root: 'max-w-3xl' },
				narrow: { root: 'max-w-xl', header: 'border-b-0 pb-0' }
			}
		},
		defaultVariants: { variant: 'list' }
	});

	export type PageVariant = VariantProps<typeof pageVariants>['variant'];
</script>

<script lang="ts">
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import type { Snippet } from 'svelte';
	import { brand } from '#lib/brand.ts';

	type Props = {
		title: string;
		description?: string;
		variant?: PageVariant;
		/** Link back to the parent list (detail pages) */
		back?: { href: string; label: string };
		/** Badges or ids next to the title */
		meta?: Snippet;
		/** Primary actions, right-aligned */
		actions?: Snippet;
		children: Snippet;
	};

	let { title, description, variant, back, meta, actions, children }: Props = $props();

	const styles = $derived(pageVariants({ variant }));
</script>

<!-- App pages (workspace, approvals, invitations, admin) never belong in search results -->
<svelte:head>
	<title>{title} · {brand.name}</title>
	<meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class={styles.root()} data-slot="page">
	<header class={styles.header()}>
		<div class="flex min-w-0 flex-col gap-1">
			{#if back}
				<a
					href={back.href}
					class="inline-flex w-fit items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
				>
					<ChevronLeft class="size-3.5" />{back.label}
				</a>
			{/if}
			<div class="flex flex-wrap items-center gap-2">
				<h1 class={styles.title()}>{title}</h1>
				{#if meta}{@render meta()}{/if}
			</div>
			{#if description}<p class={styles.description()}>{description}</p>{/if}
		</div>
		{#if actions}<div class="ml-auto flex items-center gap-2">{@render actions()}</div>{/if}
	</header>
	<div class={styles.body()}>{@render children()}</div>
</div>
