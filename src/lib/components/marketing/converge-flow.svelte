<script lang="ts" module>
	import type { Component } from 'svelte';

	/** A tool on the left: directory logo, namespace and one example call (`linear.listIssues()`) */
	export type FlowTool = { id: string; name: string; icon?: string; call: string; href: string };

	/** An AI client on the right: generic mark (`CLIENT_ICONS`), never a vendor logo */
	export type FlowClient = { label: string; icon: Component; href: string };
</script>

<script lang="ts">
	import { InView } from '#lib/components/brand/in-view.svelte.ts';
	import { MARK_RINGS } from '#lib/components/brand/paths.ts';
	import Rings from '#lib/components/brand/rings.svelte';
	import { monogram } from '#lib/components/app/service-logo.svelte';

	/**
	 * The landing hero, live: your tools (left) → the Toolkien rings (hub) → every AI client
	 * (right). Packets run along the wires on an 11 s cycle drawn entirely in CSS
	 * (`stroke-dashoffset`): first tools flow to the hub and fan out to every client, then a
	 * client sends ONE script and the hub fans it out into a call per tool (code mode) and answers
	 * once. Hover or focus a tool or client to trace its paths and see a sample call. Loops pause
	 * off screen and in hidden tabs; static with reduced motion. Tools and clients are links.
	 */
	type Props = {
		tools: FlowTool[];
		clients: FlowClient[];
		toolsCaption?: string;
		clientsCaption?: string;
	};

	let {
		tools,
		clients,
		toolsCaption = 'your tools, added once',
		clientsCaption = 'every AI client'
	}: Props = $props();

	const shownTools = $derived(tools.slice(0, 6));
	const shownClients = $derived(clients.slice(0, 5));

	// Geometry (viewBox 520 × 360): chips 132 wide, the hub tile centred at (260, 180)
	const HUB = { x: 218, y: 138, size: 84 };
	const toolY = (i: number, n: number) => 180 + (i - (n - 1) / 2) * 50;
	const clientY = (i: number, n: number) => 180 + (i - (n - 1) / 2) * 56;
	const toolWire = (i: number, n: number) => {
		const y = toolY(i, n);
		const end = 180 + (i - (n - 1) / 2) * 7;
		return `M136 ${y}C178 ${y} 180 ${end} ${HUB.x} ${end}`;
	};
	const clientWire = (i: number, n: number) => {
		const y = clientY(i, n);
		const start = 180 + (i - (n - 1) / 2) * 8;
		return `M${HUB.x + HUB.size} ${start}C342 ${start} 344 ${y} 384 ${y}`;
	};

	/*
	 * The cycle, as fractions of it (each packet runs for 12%): tools → hub, the hub fans out to
	 * every client; then the script client sends one packet in, the hub fans it out to every tool,
	 * the results come back and one answer returns. `hub-glow` and the labels follow the same marks.
	 */
	const TOOL_IN = [0, 0.05, 0.02, 0.08, 0.035, 0.065];
	const CLIENT_OUT = [0.2, 0.215, 0.205, 0.225, 0.21];
	const SCRIPT_CLIENT = 0;
	const SCRIPT_IN = 0.44;
	const FAN_OUT = 0.57;
	const RESULTS = 0.72;
	const ANSWER = 0.86;

	type Active = { kind: 'tool' | 'client'; index: number } | null;
	let active = $state<Active>(null);

	const toolOn = (i: number) => active !== null && (active.kind === 'client' || active.index === i);
	const clientOn = (i: number) => active !== null && (active.kind === 'tool' || active.index === i);

	const hoverLabel = $derived.by(() => {
		if (!active) return '';
		if (active.kind === 'tool') return shownTools[active.index]?.call ?? '';
		return `${shownClients[active.index]?.label}: ${shownTools.length} tools, one connection`;
	});
	// Mono at 11 px: about 6.7 px per character, plus padding
	const labelWidth = (text: string) => Math.round(text.length * 6.7 + 20);

	const view = new InView(0.15);

	const handlers = (kind: 'tool' | 'client', index: number) => ({
		onpointerenter: () => (active = { kind, index }),
		onpointerleave: () => (active = null),
		onfocus: () => (active = { kind, index }),
		onblur: () => (active = null)
	});

	const list = (items: string[]) =>
		items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items.join('');
	const description = $derived(
		`Diagram: ${list(shownTools.map((t) => t.name))} are added to Toolkien once, and every AI client (${list(shownClients.map((c) => c.label))}) reaches them through one connection. In code mode a client sends one script; Toolkien runs it and makes a call to each tool, then returns one answer.`
	);
</script>

{#snippet label(text: string, cls: string)}
	{@const width = labelWidth(text)}
	<g class={cls} aria-hidden="true">
		<rect class="pill" x={260 - width / 2} y="98" {width} height="22" rx="11" />
		<text class="pill-text" x="260" y="113" text-anchor="middle">{text}</text>
	</g>
{/snippet}

<figure
	class="converge"
	data-slot="converge-flow"
	data-paused={view.visible ? undefined : ''}
	data-active={active ? active.kind : undefined}
	{@attach view.attach}
>
	<figcaption class="sr-only">{description}</figcaption>
	<svg viewBox="0 0 520 360" class="block h-auto w-full overflow-visible">
		<g aria-hidden="true">
			<text class="caption" x="4" y="14">{toolsCaption}</text>
			<text class="caption" x="516" y="14" text-anchor="end">{clientsCaption}</text>

			<!-- Wires, the traces shown on hover, then the packets -->
			{#each shownTools as tool, i (tool.id)}
				{@const d = toolWire(i, shownTools.length)}
				<path class={['wire', toolOn(i) && 'on']} {d} />
				<path class={['trace', toolOn(i) && 'on']} {d} />
			{/each}
			{#each shownClients as client, i (client.label)}
				{@const d = clientWire(i, shownClients.length)}
				<path class={['wire', clientOn(i) && 'on']} {d} />
				<path class={['trace', clientOn(i) && 'on']} {d} />
			{/each}

			<g class="packets">
				{#each shownTools as tool, i (tool.id)}
					{@const d = toolWire(i, shownTools.length)}
					<path class="packet in" pathLength="100" {d} style:--at={TOOL_IN[i] ?? 0} />
					<path class="packet out" pathLength="100" {d} style:--at={FAN_OUT + i * 0.006} />
					<path
						class="packet in minor"
						pathLength="100"
						{d}
						style:--at={RESULTS + (TOOL_IN[i] ?? 0) * 0.25}
					/>
				{/each}
				{#each shownClients as client, i (client.label)}
					{@const d = clientWire(i, shownClients.length)}
					<path class="packet in" pathLength="100" {d} style:--at={CLIENT_OUT[i] ?? 0.2} />
					{#if i === SCRIPT_CLIENT}
						<path class="packet out script" pathLength="100" {d} style:--at={SCRIPT_IN} />
						<path class="packet in script" pathLength="100" {d} style:--at={ANSWER} />
					{/if}
				{/each}
			</g>

			<!-- The hub: ripples and glow behind the ink tile and its rings -->
			<rect
				class="ripple"
				x={HUB.x}
				y={HUB.y}
				width={HUB.size}
				height={HUB.size}
				rx="18"
				style:--at="0.19"
			/>
			<rect
				class="ripple strong"
				x={HUB.x}
				y={HUB.y}
				width={HUB.size}
				height={HUB.size}
				rx="18"
				style:--at="0.565"
			/>
			<rect
				class="hub-glow"
				x={HUB.x - 3}
				y={HUB.y - 3}
				width={HUB.size + 6}
				height={HUB.size + 6}
				rx="20"
			/>
			<rect class="tile" x={HUB.x} y={HUB.y} width={HUB.size} height={HUB.size} rx="18" />
			<svg x={HUB.x + 9} y={HUB.y + 9} width="66" height="66" viewBox="0 0 32 32">
				<Rings geometry={MARK_RINGS} a="var(--paper)" b="var(--ember)" draw />
			</svg>
			<text class="caption hub-caption" x="260" y="244" text-anchor="middle">Toolkien</text>

			<g class="script-labels">
				{@render label('execute(script)', 'script-label first')}
				{@render label(`${shownTools.length} calls, 1 round trip`, 'script-label second')}
			</g>
			{#if active}{@render label(hoverLabel, 'hover-label')}{/if}
		</g>

		<!-- Chips: real links, the only focusable parts -->
		{#each shownTools as tool, i (tool.id)}
			{@const y = toolY(i, shownTools.length)}
			<a
				href={tool.href}
				class={['chip', toolOn(i) && 'on']}
				aria-label="Add {tool.name} to Toolkien"
				{...handlers('tool', i)}
			>
				<rect class="chip-bg" x="4" y={y - 17} width="132" height="34" rx="7" />
				<rect class="logo-bg" x="14" y={y - 11} width="22" height="22" rx="5" />
				{#if tool.icon}
					<image href={tool.icon} x="16" y={y - 9} width="18" height="18" />
				{:else}
					<text class="monogram" x="25" y={y + 4} text-anchor="middle">{monogram(tool.name)}</text>
				{/if}
				<text class="name mono-name" x="44" y={y + 4.5}>{tool.id}</text>
			</a>
		{/each}
		{#each shownClients as client, i (client.label)}
			{@const y = clientY(i, shownClients.length)}
			{@const Icon = client.icon}
			<a
				href={client.href}
				class={['chip', clientOn(i) && 'on']}
				aria-label="Connect {client.label}"
				{...handlers('client', i)}
			>
				<rect class="chip-bg" x="384" y={y - 17} width="132" height="34" rx="7" />
				<g transform="translate(398 {y - 8})" class="client-icon">
					<Icon size={16} aria-hidden="true" />
				</g>
				<text class="name" x="422" y={y + 4.5}>{client.label}</text>
			</a>
		{/each}
	</svg>
</figure>

<style>
	.converge {
		--cycle: 11s;
		color: var(--muted-foreground);
		margin: 0;
	}

	/* Wires and traces */
	.wire,
	.trace,
	.packet {
		fill: none;
		stroke-linecap: round;
	}
	.wire {
		stroke: currentColor;
		stroke-width: 1.25;
		opacity: 0.45;
		transition:
			stroke 200ms,
			opacity 200ms;
	}
	[data-active] .wire {
		opacity: 0.2;
	}
	[data-active] .wire.on {
		stroke: var(--ember);
		opacity: 0.35;
	}
	.trace {
		stroke: var(--ember);
		stroke-width: 2;
		stroke-dasharray: 3 6;
		opacity: 0;
		transition: opacity 200ms;
	}
	.trace.on {
		opacity: 1;
		animation: march 0.9s linear infinite;
	}

	/* Packets: one short dash per run, travelling with stroke-dashoffset */
	.packets,
	.script-labels {
		transition: opacity 250ms;
	}
	[data-active] .packets,
	[data-active] .script-labels {
		opacity: 0;
	}
	.packet {
		stroke: var(--ember);
		stroke-width: 2.5;
		stroke-dasharray: 8 200;
		stroke-dashoffset: 8;
		opacity: 0;
		animation: var(--cycle) linear calc(var(--at) * var(--cycle)) infinite backwards;
	}
	.packet.in {
		animation-name: run-in;
	}
	.packet.out {
		animation-name: run-out;
	}
	.packet.minor {
		stroke: var(--brass);
		stroke-width: 2;
	}
	.packet.script {
		stroke-width: 3.5;
		stroke-dasharray: 12 200;
	}

	/* The hub */
	.tile {
		fill: var(--ink);
		stroke: var(--border);
		stroke-width: 1;
	}
	.ripple,
	.hub-glow {
		fill: none;
		stroke: var(--ember);
		transform-box: fill-box;
		transform-origin: center;
	}
	.ripple {
		stroke-width: 1.5;
		opacity: 0;
		animation: ripple var(--cycle) ease-out calc(var(--at) * var(--cycle)) infinite backwards;
	}
	.ripple.strong {
		stroke-width: 2.5;
	}
	.hub-glow {
		stroke-width: 6;
		opacity: 0.1;
		animation: hub-glow var(--cycle) ease-in-out infinite;
	}

	/* Labels above the hub: the script phase, or the hovered call */
	.pill {
		fill: var(--card);
		stroke: var(--border);
	}
	.pill-text {
		fill: var(--foreground);
		font-family: var(--font-mono);
		font-size: 11px;
	}
	.script-label {
		opacity: 0;
	}
	.script-label.first {
		animation: label-first var(--cycle) linear infinite;
	}
	.script-label.second {
		animation: label-second var(--cycle) linear infinite;
	}
	.hover-label .pill {
		stroke: var(--ember);
	}

	/* Chips */
	.chip {
		cursor: pointer;
		outline: none;
	}
	.chip-bg {
		fill: var(--card);
		stroke: var(--border);
		stroke-width: 1;
		transition: stroke 200ms;
	}
	.chip:hover .chip-bg,
	.chip.on .chip-bg {
		stroke: var(--ember);
	}
	.chip:focus-visible .chip-bg {
		stroke: var(--ring);
		stroke-width: 2.5;
	}
	.logo-bg {
		fill: white;
		stroke: var(--border);
	}
	.monogram {
		fill: var(--ink);
		font-family: var(--font-sans);
		font-size: 11px;
		font-weight: 600;
	}
	.client-icon {
		color: var(--muted-foreground);
	}
	.chip.on .client-icon {
		color: var(--ember);
	}
	.name {
		fill: var(--foreground);
		font-family: var(--font-sans);
		font-size: 14px;
		font-weight: 600;
	}
	.mono-name {
		font-family: var(--font-mono);
		font-weight: 400;
	}
	.caption {
		fill: var(--muted-foreground);
		font-family: var(--font-mono);
		font-size: 11px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.hub-caption {
		text-transform: none;
		font-size: 12px;
	}

	/* Pause the loops off screen and in hidden tabs */
	[data-paused] .packet,
	[data-paused] .ripple,
	[data-paused] .hub-glow,
	[data-paused] .script-label,
	[data-paused] .trace {
		animation-play-state: paused;
	}

	@keyframes run-in {
		0% {
			stroke-dashoffset: 8;
			opacity: 0;
		}
		1% {
			opacity: 1;
		}
		11% {
			opacity: 1;
		}
		12% {
			stroke-dashoffset: -100;
			opacity: 0;
		}
		100% {
			stroke-dashoffset: -100;
			opacity: 0;
		}
	}
	@keyframes run-out {
		0% {
			stroke-dashoffset: -100;
			opacity: 0;
		}
		1% {
			opacity: 1;
		}
		11% {
			opacity: 1;
		}
		12% {
			stroke-dashoffset: 8;
			opacity: 0;
		}
		100% {
			stroke-dashoffset: 8;
			opacity: 0;
		}
	}
	@keyframes ripple {
		0% {
			transform: scale(1);
			opacity: 0;
		}
		1% {
			opacity: 0.7;
		}
		12%,
		100% {
			transform: scale(1.45);
			opacity: 0;
		}
	}
	@keyframes hub-glow {
		0%,
		12% {
			opacity: 0.08;
		}
		19% {
			opacity: 0.55;
		}
		30%,
		50% {
			opacity: 0.08;
		}
		57% {
			opacity: 0.8;
		}
		66%,
		80% {
			opacity: 0.2;
		}
		86% {
			opacity: 0.55;
		}
		95%,
		100% {
			opacity: 0.08;
		}
	}
	@keyframes label-first {
		0%,
		40% {
			opacity: 0;
		}
		43%,
		68% {
			opacity: 1;
		}
		71%,
		100% {
			opacity: 0;
		}
	}
	@keyframes label-second {
		0%,
		71% {
			opacity: 0;
		}
		74%,
		95% {
			opacity: 1;
		}
		98%,
		100% {
			opacity: 0;
		}
	}
	@keyframes march {
		to {
			stroke-dashoffset: -9;
		}
	}

	/* Phones: bigger type, no captions, no secondary packets */
	@media (max-width: 639px) {
		.name {
			font-size: 17px;
		}
		.caption:not(.hub-caption),
		.packet.minor {
			display: none;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.packet,
		.ripple,
		.script-label {
			display: none;
		}
		.hub-glow,
		.trace.on {
			animation: none;
		}
		.hub-glow {
			opacity: 0.25;
		}
	}
</style>
