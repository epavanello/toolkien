<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export type ChecklistItem = {
		label: string;
		description?: string;
		done: boolean;
		/** Where to do it; the item becomes a link while not done */
		href?: string;
		/** Button text in the `card` variant (`Open directory`) */
		action?: string;
	};

	export const checklistVariants = tv({
		slots: {
			root: 'flex flex-col rounded-lg border bg-card',
			header: 'flex items-start gap-2',
			title: 'font-semibold',
			progress: 'text-muted-foreground tabular-nums',
			bar: 'h-1 overflow-hidden rounded-full bg-muted',
			fill: 'h-full rounded-full bg-success transition-[width]',
			list: 'flex flex-col',
			item: 'flex min-w-0 items-center gap-2.5',
			mark: 'flex shrink-0 items-center justify-center rounded-full border',
			label: 'min-w-0 truncate',
			description: 'text-muted-foreground'
		},
		variants: {
			/** `card`: page-level welcome card. `compact`: sidebar widget */
			variant: {
				card: {
					root: 'gap-3 p-4',
					title: 'text-sm',
					progress: 'text-xs',
					list: 'divide-y rounded-md border',
					item: 'px-3 py-2.5 text-sm',
					mark: 'size-5',
					label: 'font-medium',
					description: 'text-xs'
				},
				compact: {
					root: 'gap-2 p-2.5 text-xs',
					title: 'text-xs',
					progress: 'text-xs',
					list: 'gap-0.5',
					item: 'rounded-sm px-1 py-1 hover:bg-sidebar-accent',
					mark: 'size-3.5'
				}
			},
			done: {
				true: {
					mark: 'border-success bg-success text-success-foreground',
					label: 'text-muted-foreground line-through decoration-muted-foreground/50'
				},
				false: { mark: 'border-muted-foreground/40 border-dashed' }
			}
		},
		defaultVariants: { variant: 'card', done: false }
	});

	export type ChecklistVariant = VariantProps<typeof checklistVariants>['variant'];
</script>

<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '#lib/components/ui/button/index.js';

	/** A short to-do list with progress (onboarding), optionally dismissible */
	type Props = {
		title: string;
		description?: string;
		items: ChecklistItem[];
		variant?: ChecklistVariant;
		onDismiss?: () => void;
	};

	let { title, description, items, variant, onDismiss }: Props = $props();

	const styles = $derived(checklistVariants({ variant }));
	const doneCount = $derived(items.filter((item) => item.done).length);
	const headingId = $props.id();
</script>

<section class={styles.root()} aria-labelledby={headingId} data-slot="checklist">
	<header class={styles.header()}>
		<div class="flex min-w-0 flex-1 flex-col gap-0.5">
			<h2 id={headingId} class={styles.title()}>{title}</h2>
			{#if description && variant !== 'compact'}
				<p class="text-sm text-pretty text-muted-foreground">{description}</p>
			{/if}
		</div>
		<span class={styles.progress()}>{doneCount}/{items.length}</span>
		{#if onDismiss}
			<Button
				variant="ghost"
				size="icon-xs"
				icon={X}
				aria-label="Dismiss checklist"
				onclick={onDismiss}
			/>
		{/if}
	</header>
	<div
		class={styles.bar()}
		role="progressbar"
		aria-label="{doneCount} of {items.length} done"
		aria-valuemin={0}
		aria-valuemax={items.length}
		aria-valuenow={doneCount}
	>
		<div class={styles.fill()} style:width="{(doneCount / Math.max(items.length, 1)) * 100}%"></div>
	</div>
	<ul class={styles.list()}>
		{#each items as item (item.label)}
			{@const itemStyles = checklistVariants({ variant, done: item.done })}
			<li>
				{#snippet row()}
					<span class={itemStyles.mark()} aria-hidden="true">
						{#if item.done}<Check class="size-3" />{/if}
					</span>
					<span class="flex min-w-0 flex-1 flex-col">
						<span class={itemStyles.label()}>
							{item.label}<span class="sr-only">{item.done ? ' (done)' : ' (to do)'}</span>
						</span>
						{#if item.description && variant !== 'compact'}
							<span class={itemStyles.description()}>{item.description}</span>
						{/if}
					</span>
				{/snippet}
				{#if variant === 'compact' && item.href && !item.done}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- callers pass resolved paths -->
					<a href={item.href} class={itemStyles.item()}>{@render row()}</a>
				{:else}
					<div class={itemStyles.item()}>
						{@render row()}
						{#if variant !== 'compact' && item.href && !item.done}
							<Button size="xs" variant="outline" href={item.href}>{item.action ?? 'Start'}</Button>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ul>
</section>
