<script lang="ts" module>
	import { createSubscriber } from 'svelte/reactivity';

	/**
	 * One shared clock for every relative time on the page: a single 30 s interval, running only
	 * while some recent time is displayed (older ones do not subscribe).
	 */
	let current = Date.now();
	const subscribe = createSubscriber((update) => {
		current = Date.now();
		const timer = setInterval(() => {
			current = Date.now();
			update();
		}, 30_000);
		return () => clearInterval(timer);
	});
	const clock = {
		get now() {
			if (typeof window === 'undefined') return Date.now();
			subscribe();
			return current;
		}
	};
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { formatFullDate, formatRelativeShort, isRecent, machineDate } from '#lib/core/format.ts';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';

	/**
	 * Every date the app shows: a short relative label (`2 min ago`, `yesterday`, `3 Nov`) in a
	 * `<time datetime>`, kept fresh while recent, with the full date and time in the viewer's
	 * locale as tooltip (and for screen readers). `—` for missing values.
	 */
	type Props = {
		value: Date | string | number | null | undefined;
		/**
		 * `false` inside another control (an expandable row button): no focusable tooltip
		 * trigger, the full date becomes the native `title`
		 */
		interactive?: boolean;
	};

	let { value, interactive = true }: Props = $props();

	// Server and first client render agree (fixed locale); the viewer's locale and time zone
	// apply once mounted
	let mounted = $state(false);
	onMount(() => (mounted = true));

	// `YYYY-MM-DD` stays a calendar date (days only); anything else is an instant
	const datetime = $derived(machineDate(value));
	// Reading `mounted` first re-renders the label in the browser's time zone after hydration
	const now = $derived(mounted && datetime && isRecent(value) ? clock.now : Date.now());
	const label = $derived(formatRelativeShort(value, now));
	const full = $derived(formatFullDate(value, mounted ? undefined : 'en-GB'));
</script>

{#snippet text()}<span aria-hidden="true">{label}</span><span class="sr-only">{full}</span
	>{/snippet}

{#if datetime && !interactive}
	<time {datetime} title={full} class="whitespace-nowrap tabular-nums" data-slot="relative-time"
		>{@render text()}</time
	>
{:else if datetime}
	<!-- No whitespace between the parts: this sits inside sentences -->
	<Tooltip.Root
		><Tooltip.Trigger>
			{#snippet child({ props })}
				<time {...props} {datetime} class="whitespace-nowrap tabular-nums" data-slot="relative-time"
					>{@render text()}</time
				>
			{/snippet}
		</Tooltip.Trigger><Tooltip.Content>{full}</Tooltip.Content>
	</Tooltip.Root>
{:else}
	<span class="text-muted-foreground">—</span>
{/if}
