<script lang="ts" module>
	import type { Component } from 'svelte';
	import { tv, type VariantProps } from 'tailwind-variants';

	export type ChoiceItem = {
		value: string;
		label: string;
		/** Second line (kind, platform) */
		description?: string;
		icon?: Component;
		/** Small success mark (already connected, configured…) */
		done?: boolean;
	};

	export const choiceGridVariants = tv({
		slots: {
			grid: 'grid gap-2',
			tile: 'group flex h-full min-w-0 items-center gap-3 rounded-lg border bg-card text-left transition-colors outline-none hover:border-foreground/30 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=true]:border-primary aria-[current=true]:bg-primary/5 aria-[current=true]:ring-1 aria-[current=true]:ring-primary',
			icon: 'flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-aria-[current=true]:bg-primary group-aria-[current=true]:text-primary-foreground',
			text: 'flex min-w-0 flex-1 flex-col',
			label: 'truncate text-sm font-medium',
			description: 'truncate text-xs text-muted-foreground',
			done: 'size-4 shrink-0 text-success'
		},
		variants: {
			/** `md`: primary choices. `sm`: secondary, denser choices ("other clients") */
			size: {
				md: {
					grid: 'grid-cols-2 lg:grid-cols-3',
					tile: 'p-3',
					icon: 'size-9 [&_svg]:size-4.5'
				},
				sm: {
					grid: 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5',
					tile: 'gap-2 px-2.5 py-2',
					icon: 'size-7 [&_svg]:size-3.5'
				}
			}
		},
		defaultVariants: { size: 'md' }
	});

	export type ChoiceGridSize = VariantProps<typeof choiceGridVariants>['size'];

	export type ChoiceGroup = {
		/** Visible heading above the group (omit for the first, main group) */
		title?: string;
		items: ChoiceItem[];
		size?: ChoiceGridSize;
	};
</script>

<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';

	/**
	 * Tiles to pick one option, in one or more groups (main choices, then secondary ones). Tiles
	 * are links (`href(value)`), so the choice lives in the URL and can be shared; the selected
	 * tile is marked with `aria-current`. With `replaceState={false}` the tiles are plain
	 * navigation links (next steps to other pages).
	 */
	type Props = {
		label: string;
		groups: ChoiceGroup[];
		value?: string | null;
		href: (value: string) => string;
		/** Picking a tile replaces the history entry (default), instead of adding one */
		replaceState?: boolean;
	};

	let { label, groups, value = null, href, replaceState = true }: Props = $props();
</script>

<nav aria-label={label} class="flex flex-col gap-4" data-slot="choice-grid">
	{#each groups as group, index (index)}
		{@const styles = choiceGridVariants({ size: group.size })}
		<div class="flex flex-col gap-2">
			{#if group.title}<p class="text-xs font-medium text-muted-foreground">{group.title}</p>{/if}
			<ul class={styles.grid()}>
				{#each group.items as item (item.value)}
					{@const selected = item.value === value}
					<li class="min-w-0">
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- `href` builds resolved paths -->
						<a
							href={href(item.value)}
							class={styles.tile()}
							aria-current={selected ? 'true' : undefined}
							data-sveltekit-replacestate={replaceState ? '' : 'off'}
						>
							{#if item.icon}
								<span class={styles.icon()} aria-hidden="true"><item.icon /></span>
							{/if}
							<span class={styles.text()}>
								<span class={styles.label()}>{item.label}</span>
								{#if item.description}
									<span class={styles.description()}>{item.description}</span>
								{/if}
							</span>
							{#if item.done}<CircleCheck class={styles.done()} aria-label="Connected" />{/if}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	{/each}
</nav>
