<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const sidePanelVariants = tv({
		base: 'flex w-full flex-col gap-0 p-0',
		// Same variant as the sheet's own `data-[side=right]:sm:max-w-sm`, so the size wins
		variants: {
			size: {
				md: 'data-[side=right]:sm:max-w-md',
				lg: 'data-[side=right]:sm:max-w-xl',
				xl: 'data-[side=right]:sm:max-w-3xl'
			}
		},
		defaultVariants: { size: 'lg' }
	});

	export type SidePanelSize = VariantProps<typeof sidePanelVariants>['size'];
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Sheet from '#lib/components/ui/sheet/index.js';

	/** Details of a table row, sliding in from the right; `footer` holds the actions */
	type Props = {
		open?: boolean;
		title: string;
		description?: string;
		size?: SidePanelSize;
		/** Before the title: a service logo, an avatar */
		media?: Snippet;
		meta?: Snippet;
		footer?: Snippet;
		children: Snippet;
	};

	let {
		open = $bindable(false),
		title,
		description,
		size,
		media,
		meta,
		footer,
		children
	}: Props = $props();
</script>

<Sheet.Root bind:open>
	<Sheet.Content class={sidePanelVariants({ size })}>
		<!-- min-h-14 + centered: the title row lines up with the close button (top-3.5, 28px) -->
		<Sheet.Header class="min-h-14 justify-center border-b px-4 py-2 pr-12">
			<div class="flex flex-wrap items-center gap-2">
				{#if media}{@render media()}{/if}
				<Sheet.Title>{title}</Sheet.Title>
				{#if meta}{@render meta()}{/if}
			</div>
			{#if description}<Sheet.Description>{description}</Sheet.Description>{/if}
		</Sheet.Header>
		<!-- `shrink-0`: sections with `overflow-hidden` would otherwise shrink to fit and clip instead of scrolling -->
		<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 *:shrink-0">
			{@render children()}
		</div>
		{#if footer}<Sheet.Footer class="flex-row justify-end border-t px-4 py-3"
				>{@render footer()}</Sheet.Footer
			>{/if}
	</Sheet.Content>
</Sheet.Root>
