<script lang="ts" module>
	import { tv } from 'tailwind-variants';

	export const contextSavingsVariants = tv({
		slots: {
			root: 'flex flex-col gap-4',
			bars: 'flex flex-col gap-2.5',
			row: 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[10rem_minmax(0,1fr)_7.5rem]',
			label: 'text-sm text-muted-foreground',
			track:
				'order-last col-span-2 h-2.5 overflow-clip rounded-full bg-muted sm:order-none sm:col-span-1',
			fill: 'h-full rounded-full',
			value: 'text-right text-sm font-medium tabular-nums',
			heaviest: 'flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground',
			note: 'text-xs text-muted-foreground'
		},
		variants: {
			side: {
				native: { fill: 'bg-muted-foreground/60' },
				gateway: { fill: 'bg-primary' }
			}
		}
	});

	/** The connector with the heaviest definitions, named in a highlight line */
	export type HeaviestConnector = {
		name: string;
		icon?: string | null;
		tools: number;
		chars: number;
	};
</script>

<script lang="ts">
	import { formatNumber } from '#lib/core/format.ts';
	import {
		CHARS_PER_TOKEN,
		contextSavings,
		estimateTokens,
		formatTokens
	} from '#lib/core/tokens.ts';
	import ServiceLogo from './service-logo.svelte';
	import Stats from './stats.svelte';

	/**
	 * Context an agent carries before its first message, with every tool connected natively
	 * against Toolkien's fixed six: key figures, two bars to scale and how they were estimated.
	 */
	type Props = {
		/** Usable tools counted, and across how many connectors */
		tools: number;
		connectors: number;
		/** Characters of their native definitions (`ToolFootprint.chars`) */
		nativeChars: number;
		/** Characters Toolkien loads instead (six definitions + instructions) */
		gatewayChars: number;
		heaviest?: HeaviestConnector;
	};

	let { tools, connectors, nativeChars, gatewayChars, heaviest }: Props = $props();

	const savings = $derived(contextSavings({ tools, nativeChars, gatewayChars }));
	const scale = $derived(Math.max(savings.native, savings.gateway, 1));
	const styles = contextSavingsVariants();

	const items = $derived([
		{
			label: 'Tools in reach',
			value: tools,
			hint: `across ${connectors} ${connectors === 1 ? 'connector' : 'connectors'}`
		},
		{
			label: 'Connected natively',
			value: formatTokens(savings.native),
			hint: 'loaded in every turn'
		},
		{
			label: 'Through Toolkien',
			value: formatTokens(savings.gateway),
			hint: 'six tools, however many you add'
		},
		savings.saved > 0
			? {
					label: 'Saved in every turn',
					value: formatTokens(savings.saved),
					hint: `${savings.percent}% less context`,
					tone: 'success' as const
				}
			: {
					label: 'Break-even',
					value: `+${formatNumber(savings.toBreakEven)} tools`,
					hint: 'then every tool you add is saved'
				}
	]);

	const bars = $derived([
		{ side: 'native' as const, label: 'Connected natively', tokens: savings.native },
		{ side: 'gateway' as const, label: 'Through Toolkien', tokens: savings.gateway }
	]);
</script>

<div class={styles.root()}>
	<Stats {items} />
	<div class={styles.bars()}>
		{#each bars as bar (bar.side)}
			{@const barStyles = contextSavingsVariants({ side: bar.side })}
			<div class={styles.row()}>
				<span class={styles.label()}>{bar.label}</span>
				<div class={styles.track()} role="img" aria-label="{bar.label}: {formatTokens(bar.tokens)}">
					<div
						class={barStyles.fill()}
						style:width="{Math.max(1, (bar.tokens / scale) * 100)}%"
					></div>
				</div>
				<span class={styles.value()}>{formatTokens(bar.tokens)}</span>
			</div>
		{/each}
	</div>
	{#if heaviest}
		<p class={styles.heaviest()}>
			Heaviest connector:
			<ServiceLogo name={heaviest.name} src={heaviest.icon} size="xs" withName />
			<span
				>· {formatNumber(heaviest.tools)}
				{heaviest.tools === 1 ? 'tool' : 'tools'}, {formatTokens(estimateTokens(heaviest.chars))} on its
				own</span
			>
		</p>
	{/if}
	<p class={styles.note()}>
		Estimate from the definitions stored for this workspace (name, description and input schema of
		each tool you can use, blocked tools left out), at {CHARS_PER_TOKEN} characters per token. Agents
		also read the declarations of the few tools they describe, on demand.
	</p>
</div>
