<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const calloutVariants = tv({
		slots: {
			root: 'flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm',
			icon: 'mt-0.5 size-4 shrink-0',
			body: 'flex min-w-0 flex-1 flex-col gap-0.5',
			title: 'font-medium',
			description: 'text-pretty text-muted-foreground',
			action: 'flex items-center gap-2'
		},
		variants: {
			/** `info` neutral notes, `warning` something needs attention, `danger` blocked/suspended */
			tone: {
				info: { root: 'bg-card', icon: 'text-primary' },
				warning: { root: 'border-warning/40 bg-warning/5', icon: 'text-warning' },
				danger: { root: 'border-destructive/40 bg-destructive/5', icon: 'text-destructive' }
			}
		},
		defaultVariants: { tone: 'info' }
	});

	export type CalloutTone = VariantProps<typeof calloutVariants>['tone'];
</script>

<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { Snippet } from 'svelte';

	/**
	 * A page-level notice (2FA required, workspace scheduled for deletion, suspended…) with an
	 * optional action on the right.
	 */
	type Props = {
		title: string;
		description?: string;
		tone?: CalloutTone;
		action?: Snippet;
		children?: Snippet;
	};

	let { title, description, tone = 'info', action, children }: Props = $props();

	const styles = $derived(calloutVariants({ tone }));
	const Icon = $derived(
		tone === 'danger' ? CircleAlert : tone === 'warning' ? TriangleAlert : Info
	);
</script>

<div class={styles.root()} role={tone === 'info' ? 'note' : 'status'} data-slot="callout">
	<Icon class={styles.icon()} aria-hidden="true" />
	<div class={styles.body()}>
		<p class={styles.title()}>{title}</p>
		{#if description}<p class={styles.description()}>{description}</p>{/if}
		{#if children}{@render children()}{/if}
	</div>
	{#if action}<div class={styles.action()}>{@render action()}</div>{/if}
</div>
