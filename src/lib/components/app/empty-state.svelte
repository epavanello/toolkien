<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const emptyStateVariants = tv({
		base: 'flex flex-col items-center justify-center gap-3 text-center',
		variants: {
			/** `page` fills a section, `inline` sits inside a table or panel */
			variant: { page: 'min-h-[40vh] p-8', inline: 'p-6' }
		},
		defaultVariants: { variant: 'inline' }
	});

	export type EmptyStateVariant = VariantProps<typeof emptyStateVariants>['variant'];
</script>

<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	type Props = {
		title: string;
		description?: string;
		icon?: Component;
		variant?: EmptyStateVariant;
		/** Call to action, usually one Button */
		action?: Snippet;
	};

	let { title, description, icon: Icon, variant, action }: Props = $props();
</script>

<div class={emptyStateVariants({ variant })} data-slot="empty-state">
	{#if Icon}
		<span class="flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
			<Icon class="size-4" />
		</span>
	{/if}
	<div class="flex max-w-sm flex-col gap-1">
		<p class="text-sm font-medium">{title}</p>
		{#if description}<p class="text-sm text-pretty text-muted-foreground">{description}</p>{/if}
	</div>
	{#if action}{@render action()}{/if}
</div>
