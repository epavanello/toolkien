<script lang="ts" module>
	/**
	 * The brand's spot illustrations, drawn from the same parts as the logo (the anvil, the ember
	 * spark, converging lines). Line art in `currentColor` + one ember accent, so they follow the
	 * theme. Decorative only (`aria-hidden`): the text next to them carries the meaning.
	 *
	 * - `converge`: your tools → Toolkien (the rings) → every AI client (landing hero, auth)
	 * - `forge`: an anvil with sparks, nothing made yet (empty lists of connectors, tools)
	 * - `ledger`: an open log (empty activity, history)
	 * - `seal`: a hallmark plate (nothing to approve, all verified)
	 * - `trail`: a path that ends at a signpost (404)
	 * - `gate`: lines converging into the gateway (connect, onboarding)
	 * - `offline`: the gateway with its outgoing line cut (offline, unavailable)
	 * - `crack`: a cracked anvil (5xx)
	 */
	export type BrandArtName =
		'converge' | 'forge' | 'ledger' | 'seal' | 'trail' | 'gate' | 'offline' | 'crack';
</script>

<script lang="ts">
	import { cn } from '#lib/utils.js';
	import { ANVIL_PATH, MARK_RINGS } from './paths.ts';
	import Rings from './rings.svelte';

	type Props = {
		name: BrandArtName;
		/** Server namespaces on the left of `converge` */
		servers?: string[];
		/** AI clients on the right of `converge` */
		clients?: string[];
		serversCaption?: string;
		clientsCaption?: string;
		class?: string;
	};

	let {
		name,
		servers = ['github', 'linear', 'notion', 'sentry', 'stripe', 'supabase'],
		clients = ['Claude', 'ChatGPT', 'Codex', 'Cursor', 'VS Code'],
		serversCaption = 'your tools, added once',
		clientsCaption = 'every AI client',
		class: className
	}: Props = $props();

	const spark = (x: number, y: number, s: number) =>
		`M${x} ${y - s}L${x + s} ${y}L${x} ${y + s}L${x - s} ${y}Z`;

	// `converge` geometry (viewBox 480×320): chips on the left, the gateway tile, the agent
	const chipY = (index: number, count: number) => 160 + (index - (count - 1) / 2) * 46;
	const shown = $derived(servers.slice(0, 6));
	const shownClients = $derived(clients.slice(0, 6));
</script>

{#if name === 'converge'}
	<svg
		viewBox="0 0 480 320"
		class={cn('brand-art w-full', className)}
		aria-hidden="true"
		data-slot="brand-art"
	>
		{#each shown as server, index (server)}
			{@const y = chipY(index, shown.length)}
			<path class="wire" d="M128 {y}C170 {y} 172 160 202 160" />
			<rect class="surface" x="8" y={y - 16} width="120" height="32" rx="6" />
			<circle class="dot" cx="26" cy={y} r="3" />
			<text class="label" x="38" y={y + 5}>{server}</text>
		{/each}
		{#each shownClients as client, index (client)}
			{@const y = chipY(index, shownClients.length)}
			<path class="flow" d="M278 160C308 160 312 {y} 352 {y}" />
			<rect class="surface" x="352" y={y - 16} width="120" height="32" rx="6" />
			<text class="label strong" x="366" y={y + 5}>{client}</text>
		{/each}
		<rect class="tile" x="202" y="122" width="76" height="76" rx="16" />
		<svg x="208" y="128" width="64" height="64" viewBox="0 0 32 32">
			<Rings geometry={MARK_RINGS} a="var(--paper)" b="var(--ember)" />
		</svg>
		<path class="hot" d={spark(288, 112, 6)} />
		<path class="hot dim" d={spark(300, 126, 3.5)} />
		<text class="caption" x="68" y="306" text-anchor="middle">{serversCaption}</text>
		<text class="caption" x="240" y="226" text-anchor="middle">Toolkien</text>
		<text class="caption" x="412" y="306" text-anchor="middle">{clientsCaption}</text>
	</svg>
{:else}
	<svg
		viewBox="0 0 120 80"
		class={cn('brand-art h-20 w-auto', className)}
		aria-hidden="true"
		data-slot="brand-art"
	>
		{#if name === 'forge' || name === 'crack'}
			<path class="line faint" d="M10 66H110" />
			<path
				class="surface line"
				d={ANVIL_PATH}
				transform="translate(37 27) scale(1.5)"
				vector-effect="non-scaling-stroke"
			/>
			{#if name === 'forge'}
				<path class="hot" d={spark(88, 26, 4)} />
				<path class="hot dim" d={spark(97, 35, 2.5)} />
				<path class="hot dim" d={spark(80, 17, 2.5)} />
			{:else}
				<path class="line" d="M62 37.5l-3 5 4 4-2.5 5" />
				<path class="brass" d={spark(90, 30, 2.5)} />
			{/if}
		{:else if name === 'ledger'}
			<rect class="surface line" x="30" y="12" width="60" height="58" rx="4" />
			<path class="line faint" d="M40 30H80M40 39H80M40 48H80M40 57H66" />
			<path class="hot-line" d="M40 30H52" />
			<path class="hot" d="M72 12v15l4-3 4 3V12Z" />
		{:else if name === 'seal'}
			<path class="surface line" d="M40 14H80L88 22V58L80 66H40L32 58V22Z" />
			<svg x="44" y="24" width="32" height="32" viewBox="0 0 32 32" class="emboss">
				<Rings geometry={MARK_RINGS} a="currentColor" b="currentColor" />
			</svg>
			<circle class="ok" cx="86" cy="62" r="9" />
			<path class="ok-mark" d="M82 62l3 3 5-6" />
		{:else if name === 'trail'}
			<path class="line faint" d="M8 68H112" />
			<path class="line dashed" d="M10 62C26 44 40 70 58 54S82 40 92 50" />
			<path class="line" d="M98 26V68" />
			<path class="surface line" d="M84 26H110L114 30L110 34H84Z" />
			<path class="surface line" d="M112 38H88L84 42L88 46H112Z" />
			<path class="hot" d={spark(92, 52, 3)} />
		{:else}
			<path class="wire" d="M8 18C30 18 34 40 50 40M8 40H50M8 62C30 62 34 40 50 40" />
			<rect class="tile" x="50" y="26" width="28" height="28" rx="6" />
			<svg x="51" y="27" width="26" height="26" viewBox="0 0 32 32">
				<Rings geometry={MARK_RINGS} a="var(--paper)" b="var(--ember)" />
			</svg>
			{#if name === 'gate'}
				<path class="flow" d="M78 40H112" />
				<path class="hot dim" d={spark(100, 28, 2.5)} />
			{:else}
				<path class="hot-line" d="M78 40H90M100 40H112" />
				<path class="line" d="M92 34l-2 12M100 34l-2 12" />
			{/if}
		{/if}
	</svg>
{/if}

<style>
	.brand-art {
		color: var(--muted-foreground);
		overflow: visible;
	}
	.line,
	.wire,
	.hot-line,
	.flow {
		fill: none;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.line {
		stroke: currentColor;
		stroke-width: 1.5;
	}
	.faint {
		opacity: 0.45;
	}
	.dashed {
		stroke-dasharray: 2 5;
	}
	.wire {
		stroke: currentColor;
		stroke-width: 1.25;
		opacity: 0.5;
	}
	.surface {
		fill: var(--card);
		stroke: var(--border);
		stroke-width: 1;
	}
	.surface.line {
		stroke: currentColor;
		stroke-width: 1.5;
	}
	.tile {
		fill: var(--ink);
		stroke: var(--border);
		stroke-width: 1;
	}
	.hot {
		fill: var(--ember);
	}
	.dim {
		opacity: 0.6;
	}
	.brass {
		fill: var(--brass);
	}
	.hot-line,
	.flow {
		stroke: var(--ember);
		stroke-width: 2.5;
	}
	.flow {
		stroke-dasharray: 6 5;
		animation: flow 1.6s linear infinite;
	}
	.emboss {
		opacity: 0.25;
	}
	.ok {
		fill: var(--success);
	}
	.ok-mark {
		fill: none;
		stroke: var(--success-foreground);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.dot {
		fill: var(--success);
	}
	.label {
		fill: var(--foreground);
		font-family: var(--font-mono);
		font-size: 14px;
	}
	.label.strong {
		font-family: var(--font-sans);
		font-weight: 600;
	}
	.label.muted,
	.caption {
		fill: var(--muted-foreground);
	}
	.caption {
		font-family: var(--font-mono);
		font-size: 12px;
		letter-spacing: 0.04em;
	}
	@keyframes flow {
		to {
			stroke-dashoffset: -11;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.flow {
			animation: none;
		}
	}
</style>
