<script lang="ts" module>
	import type { CodeToken } from '#lib/server/highlight.ts';

	/** One measured quantity; `amount` (0–1) sets the bar length relative to the other panel */
	export type CompareMetric = { label: string; value: string; amount: number };

	/**
	 * How a panel draws its situation:
	 * - `calls`: a long ladder of round trips (agent ↔ tool), `count` rungs
	 * - `script`: one script block with its few calls folded inside; `highlighted` (same lines as
	 *   Shiki tokens, from the server) colors it, the first line (its caption comment) stays primary
	 * - `mesh`: a grid of setups, `rows` × `columns` dots (every client × every tool)
	 * - `hub`: the same tools and clients, each connected once to the hub
	 */
	export type CompareVisual =
		| { kind: 'calls'; count: number }
		| { kind: 'script'; lines: string[]; highlighted?: CodeToken[][] }
		| { kind: 'mesh'; rows: string[]; columns: number }
		| { kind: 'hub'; rows: string[]; columns: number };

	export type ComparePanel = {
		label: string;
		title: string;
		visual: CompareVisual;
		metrics: CompareMetric[];
	};

	/** `~180k` at `progress` 0.5 → `~90k`; the exact string at 1 (and for values without a number) */
	export function countUp(value: string, progress: number): string {
		if (progress >= 1) return value;
		const match = /^(\D*?)(\d+(?:\.\d+)?)(.*)$/.exec(value);
		if (!match) return value;
		const [, prefix, number, suffix] = match;
		const decimals = number.split('.')[1]?.length ?? 0;
		return `${prefix}${(Number(number) * Math.max(0, progress)).toFixed(decimals)}${suffix}`;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';
	import { cubicOut, sineInOut } from 'svelte/easing';
	import { prefersReducedMotion, Tween } from 'svelte/motion';
	import { watch } from 'runed';
	import { InView } from '#lib/components/brand/in-view.svelte.ts';
	import Hallmark from './hallmark.svelte';

	/**
	 * Before / after, side by side: a small drawing of each situation and the same metrics as
	 * bars. `note` says where the numbers come from (illustrative examples must say so).
	 *
	 * `animated` plays it once when scrolled into view: the slow side (before) accumulates its
	 * round trips or setups while its counters climb; the fast side (after) runs and settles in
	 * under a second. A new tool is added to the matrices: one setup per client before, lit in
	 * every client at once after. Counters and bars ease to the final values; SSR, no-JS and
	 * reduced motion show the final state. Screen readers always get the final numbers.
	 */
	let {
		before,
		after,
		note,
		animated = true
	}: { before: ComparePanel; after: ComparePanel; note?: string; animated?: boolean } = $props();

	/** Milliseconds: the slow side takes its time, the fast side is done almost at once (bars use
	 * the same easing as the counters: sine in-out for slow, cubic out for fast) */
	const SLOW = 3200;
	const FAST = 900;

	const view = new InView(0.35);
	let phase = $state<'static' | 'armed' | 'run'>('static');
	const slow = new Tween(1, { duration: SLOW, easing: sineInOut });
	const fast = new Tween(1, { duration: FAST, easing: cubicOut });

	onMount(() => {
		if (!animated || prefersReducedMotion.current) return;
		phase = 'armed';
		slow.set(0, { duration: 0 });
		fast.set(0, { duration: 0 });
	});

	watch(
		() => view.seen,
		(seen) => {
			if (!seen || phase !== 'armed') return;
			phase = 'run';
			slow.target = 1;
			fast.target = 1;
		}
	);
</script>

{#snippet visual(item: ComparePanel)}
	{#if item.visual.kind === 'calls'}
		{@const step = (SLOW - 200) / item.visual.count}
		<div class="flex flex-wrap gap-1">
			{#each { length: item.visual.count }, index (index)}
				<span
					class="tick h-2 w-6 rounded-full {index % 2 === 0
						? 'bg-foreground/25'
						: 'bg-foreground/45'}"
					style:--delay="{Math.round(index * step)}ms"
				></span>
			{/each}
		</div>
	{:else if item.visual.kind === 'script'}
		<div class="relative flex flex-col mono text-xs leading-relaxed text-muted-foreground">
			{#each item.visual.lines as line, index (index)}
				{@const tokens = index === 0 ? undefined : item.visual.highlighted?.[index]}
				<span
					class="line whitespace-pre {index === 0 ? 'text-primary' : ''}"
					style:--delay="{index * 70}ms"
					>{#if tokens}{#each tokens as token, at (at)}<span
								class="token"
								style:--shiki-light={token.light}
								style:--shiki-dark={token.dark}>{token.content}</span
							>{/each}{:else}{line}{/if}</span
				>
			{/each}
			<span class="run-bar absolute inset-x-0 -bottom-1.5 h-0.5 rounded-full bg-primary"></span>
		</div>
	{:else}
		{@const hub = item.visual.kind === 'hub'}
		{@const columns = item.visual.columns}
		{@const last = columns - 1}
		<div class="flex flex-col gap-1.5">
			{#if hub}
				<div class="flex items-center gap-2">
					<span class="w-16 shrink-0 truncate text-xs font-medium">Toolkien</span>
					<span class="size-2.5 shrink-0"></span>
					<span class="flex gap-1">
						{#each { length: columns }, column (column)}
							<span
								class={['dot size-2.5 rounded-full bg-primary', column === last && 'added ping']}
								style:--delay="300ms"
							></span>
						{/each}
					</span>
				</div>
			{/if}
			{#each item.visual.rows as row, index (row)}
				<div class="flex items-center gap-2">
					<span class="w-16 shrink-0 truncate text-xs text-muted-foreground">{row}</span>
					{#if hub}
						<span class="size-2.5 shrink-0 rounded-full bg-primary"></span>
					{/if}
					<span class="flex gap-1">
						{#each { length: columns }, column (column)}
							<span
								class={[
									'dot size-2.5 rounded-full',
									hub ? 'ring-1 ring-primary/60 ring-inset' : 'bg-foreground/35',
									column === last && 'added',
									column === last && hub && 'lit'
								]}
								style:--delay={hub ? '650ms' : `${500 + index * Math.round((SLOW - 800) / 5)}ms`}
							></span>
						{/each}
					</span>
				</div>
			{/each}
		</div>
	{/if}
{/snippet}

{#snippet panel(item: ComparePanel, featured: boolean)}
	{@const progress = featured ? fast.current : slow.current}
	<li
		class="flex min-w-0 flex-col gap-5 rounded-lg border bg-card p-5 shadow-plate sm:p-6 {featured
			? 'border-primary/50 ring-1 ring-primary/20'
			: ''}"
		style:--duration="{featured ? FAST : SLOW}ms"
		style:--ease={featured ? 'cubic-bezier(0.33, 1, 0.68, 1)' : 'cubic-bezier(0.37, 0, 0.63, 1)'}
	>
		<div class="flex flex-col gap-2">
			<Hallmark tone={featured ? 'ember' : 'muted'}>{item.label}</Hallmark>
			<h3 class="font-display text-2xl font-semibold text-balance">{item.title}</h3>
		</div>

		<div class="min-h-28 overflow-x-auto rounded-md border bg-muted/40 p-3" aria-hidden="true">
			{@render visual(item)}
		</div>

		<dl class="flex flex-col gap-3">
			{#each item.metrics as metric (metric.label)}
				<div class="flex flex-col gap-1">
					<div class="flex items-baseline justify-between gap-3 text-sm">
						<dt class="text-muted-foreground">{metric.label}</dt>
						<dd class="font-semibold tabular-nums">
							<span class="sr-only">{metric.value}</span>
							<span aria-hidden="true">{countUp(metric.value, progress)}</span>
						</dd>
					</div>
					<div class="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
						<div
							class="bar h-full rounded-full {featured ? 'bg-primary' : 'bg-foreground/40'}"
							style:width="{Math.max(2, Math.round(metric.amount * 100))}%"
						></div>
					</div>
				</div>
			{/each}
		</dl>
	</li>
{/snippet}

<div
	class="compare flex flex-col gap-3"
	data-slot="compare"
	data-phase={phase}
	{@attach view.attach}
>
	<ul class="grid gap-4 md:grid-cols-2">
		{@render panel(before, false)}
		{@render panel(after, true)}
	</ul>
	{#if note}<p class="text-xs text-muted-foreground">{note}</p>{/if}
</div>

<style>
	/* Armed: hydrated, waiting to be seen. Everything that will play starts hidden. */
	[data-phase='armed'] .tick,
	[data-phase='armed'] .line,
	[data-phase='armed'] .added {
		opacity: 0;
	}
	[data-phase='armed'] .bar,
	[data-phase='armed'] .run-bar {
		transform: scaleX(0);
	}
	.bar,
	.run-bar {
		transform-origin: left;
	}
	.run-bar {
		opacity: 0;
	}
	/* Shiki dual-theme colors, following mode-watcher's `.dark` like `layout.css` */
	.token {
		color: var(--shiki-light, inherit);
	}
	:global(.dark) .token {
		color: var(--shiki-dark, inherit);
	}

	/* Run: CSS only, transforms and opacity */
	[data-phase='run'] .tick {
		animation: tick-in 160ms ease-out var(--delay) both;
	}
	[data-phase='run'] .line {
		animation: line-in 220ms ease-out var(--delay) both;
	}
	[data-phase='run'] .bar {
		animation: grow var(--duration) var(--ease) both;
	}
	[data-phase='run'] .run-bar {
		animation: run-bar 900ms ease-in-out both;
	}
	[data-phase='run'] .added {
		animation: pop 260ms cubic-bezier(0.34, 1.56, 0.64, 1) var(--delay) both;
	}
	.ping,
	.lit {
		position: relative;
	}
	[data-phase='run'] .ping::after,
	[data-phase='run'] .lit::after {
		content: '';
		position: absolute;
		inset: -3px;
		border-radius: 9999px;
		border: 1.5px solid var(--primary);
		opacity: 0;
		animation: ping 700ms ease-out var(--delay) both;
	}

	@keyframes tick-in {
		from {
			opacity: 0;
			transform: scaleX(0.3);
		}
	}
	@keyframes line-in {
		from {
			opacity: 0;
			transform: translateY(3px);
		}
	}
	@keyframes grow {
		from {
			transform: scaleX(0);
		}
	}
	@keyframes run-bar {
		0% {
			opacity: 1;
			transform: scaleX(0);
		}
		80% {
			opacity: 1;
			transform: scaleX(1);
		}
		100% {
			opacity: 0;
			transform: scaleX(1);
		}
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: scale(0);
		}
	}
	@keyframes ping {
		0% {
			opacity: 0.9;
			transform: scale(0.6);
		}
		100% {
			opacity: 0;
			transform: scale(1.9);
		}
	}
</style>
