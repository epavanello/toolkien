<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import { tv, type VariantProps } from 'tailwind-variants';

	export type StepStatus = 'todo' | 'current' | 'done';

	export type StepItem = {
		/** Inline markup allowed: `**label**`, `` `code` `` */
		title: string;
		description?: string;
		status?: StepStatus;
		/** Anchor id, so other places can link to the step */
		id?: string;
		/** Body of the step (`flow` variant): buttons, commands, notes */
		content?: Snippet;
	};

	export const stepsVariants = tv({
		slots: {
			root: 'flex flex-col',
			item: 'relative flex min-w-0 scroll-mt-14 gap-3',
			marker:
				'relative z-10 flex shrink-0 items-center justify-center rounded-full border bg-background font-medium tabular-nums',
			body: 'flex min-w-0 flex-1 flex-col',
			title: 'text-pretty',
			description: 'text-sm text-pretty text-muted-foreground',
			content: 'flex min-w-0 flex-col gap-3'
		},
		variants: {
			/**
			 * `flow`: the sections of a guided task (numbered, with a rail and a status per step).
			 * `list`: a compact numbered list of instructions inside a step.
			 */
			variant: {
				flow: {
					root: 'gap-0',
					item: 'pb-8 last:pb-0 [&:not(:last-child)]:before:absolute [&:not(:last-child)]:before:top-8 [&:not(:last-child)]:before:bottom-0 [&:not(:last-child)]:before:left-3.5 [&:not(:last-child)]:before:w-px [&:not(:last-child)]:before:bg-border',
					marker: 'size-7 text-xs',
					body: 'gap-3 pt-0.5',
					title: 'text-base font-semibold tracking-tight'
				},
				list: {
					root: 'gap-2',
					item: 'items-baseline',
					marker: 'size-5 translate-y-px text-[0.7rem] text-muted-foreground',
					body: 'gap-1',
					title: 'text-sm text-muted-foreground'
				}
			},
			status: {
				todo: {},
				current: { marker: 'border-primary text-primary' },
				done: { marker: 'border-success bg-success text-success-foreground' }
			}
		},
		defaultVariants: { variant: 'flow', status: 'todo' }
	});

	export type StepsVariant = VariantProps<typeof stepsVariants>['variant'];
</script>

<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import InlineText from './inline-text.svelte';

	/** Numbered steps: a guided flow (`flow`) or a list of instructions (`list`) */
	type Props = { items: StepItem[]; variant?: StepsVariant; label?: string };

	let { items, variant, label }: Props = $props();
</script>

<ol class={stepsVariants({ variant }).root()} aria-label={label} data-slot="steps">
	{#each items as item, index (index)}
		{@const styles = stepsVariants({ variant, status: item.status })}
		<li class={styles.item()} id={item.id}>
			<span class={styles.marker()} aria-hidden="true">
				{#if item.status === 'done'}<Check class="size-3.5" />{:else}{index + 1}{/if}
			</span>
			<div class={styles.body()}>
				<div class="flex flex-col gap-0.5">
					<svelte:element this={variant === 'list' ? 'span' : 'h3'} class={styles.title()}>
						<InlineText text={item.title} />
						{#if item.status === 'done'}<span class="sr-only">(done)</span>{/if}
					</svelte:element>
					{#if item.description}<p class={styles.description()}>{item.description}</p>{/if}
				</div>
				{#if item.content}<div class={styles.content()}>{@render item.content()}</div>{/if}
			</div>
		</li>
	{/each}
</ol>
