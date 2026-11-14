<script lang="ts" module>
	import { tv } from 'tailwind-variants';

	export const statusBadgeVariants = tv({
		slots: {
			root: 'inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-xs font-medium whitespace-nowrap',
			dot: 'size-1.5 rounded-full'
		},
		variants: {
			tone: {
				success: { root: 'bg-success/10 text-success dark:bg-success/20', dot: 'bg-success' },
				pending: { root: 'bg-warning/15 text-warning dark:bg-warning/20', dot: 'bg-warning' },
				error: {
					root: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
					dot: 'bg-destructive'
				},
				neutral: { root: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' }
			}
		},
		defaultVariants: { tone: 'neutral' }
	});
</script>

<script lang="ts">
	import { humanize, toneFor, type Tone } from './status.ts';

	/**
	 * A status with its semantic color: pass the raw domain value (`completed`, `pending_auth`)
	 * and the tone and label are derived; override them only when the mapping is wrong.
	 */
	type Props = { status: string; tone?: Tone; label?: string };

	let { status, tone, label }: Props = $props();

	const styles = $derived(statusBadgeVariants({ tone: tone ?? toneFor(status) }));
</script>

<span class={styles.root()} data-slot="status-badge">
	<span class={styles.dot()} aria-hidden="true"></span>
	{label ?? humanize(status)}
</span>
