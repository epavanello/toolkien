<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const calloutVariants = tv({
		slots: {
			root: 'flex flex-wrap items-start gap-3 rounded-lg border px-4 py-3 text-sm',
			icon: 'mt-0.5 size-4 shrink-0',
			body: 'flex min-w-0 flex-1 basis-56 flex-col gap-0.5',
			title: 'font-medium',
			time: 'ml-1.5 font-normal text-muted-foreground',
			description: 'text-pretty text-muted-foreground',
			action: 'flex flex-wrap items-center gap-2'
		},
		variants: {
			/**
			 * `info` neutral notes, `warning` something needs attention, `danger` blocked/suspended,
			 * `success` something completed (a client connected), `pending` waiting on something
			 * happening elsewhere (spinner)
			 */
			tone: {
				info: { root: 'bg-card', icon: 'text-primary' },
				success: { root: 'border-success/40 bg-success/5', icon: 'text-success' },
				pending: { root: 'bg-card', icon: 'animate-spin text-muted-foreground' },
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
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { Snippet } from 'svelte';
	import RelativeTime from './relative-time.svelte';

	/**
	 * A page-level notice (passkey required, workspace scheduled for deletion, suspended…) with an
	 * optional action on the right.
	 */
	type Props = {
		title: string;
		description?: string;
		tone?: CalloutTone;
		/** When it happened or will happen, after the title: `Platform paused · since 2 h ago` */
		time?: { label?: string; value: Date | string | number };
		action?: Snippet;
		children?: Snippet;
	};

	let { title, description, tone = 'info', time, action, children }: Props = $props();

	const styles = $derived(calloutVariants({ tone }));
	const ICONS = {
		info: Info,
		warning: TriangleAlert,
		danger: CircleAlert,
		success: CircleCheck,
		pending: LoaderCircle
	};
	const Icon = $derived(ICONS[tone ?? 'info']);
</script>

<div
	class={styles.root()}
	role={tone === 'info' ? 'note' : 'status'}
	aria-live={tone === 'success' || tone === 'pending' ? 'polite' : undefined}
	data-slot="callout"
>
	<Icon class={styles.icon()} aria-hidden="true" />
	<div class={styles.body()}>
		<p class={styles.title()}>
			{title}{#if time}<span class={styles.time()}>
					· {time.label ? `${time.label} ` : ''}<RelativeTime value={time.value} /></span
				>{/if}
		</p>
		{#if description}<p class={styles.description()}>{description}</p>{/if}
		{#if children}{@render children()}{/if}
	</div>
	{#if action}<div class={styles.action()}>{@render action()}</div>{/if}
</div>
