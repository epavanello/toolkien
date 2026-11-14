<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const serviceLogoVariants = tv({
		slots: {
			root: 'inline-flex min-w-0 items-center',
			tile: 'relative inline-flex shrink-0 items-center justify-center overflow-hidden font-semibold ring-1 ring-foreground/10 select-none',
			image: 'size-full bg-white object-contain',
			name: 'min-w-0 truncate'
		},
		variants: {
			/** `xs` 16 px (inline, group headers) · `sm` 20 px (table cells) · `md` 28 px · `lg` 40 px (panel titles) */
			size: {
				xs: { root: 'gap-1.5', tile: 'size-4 rounded-[4px] text-[0.55rem]' },
				sm: { root: 'gap-2', tile: 'size-5 rounded-[5px] text-[0.65rem]' },
				md: { root: 'gap-2.5', tile: 'size-7 rounded-md text-xs', name: 'font-medium' },
				lg: { root: 'gap-3', tile: 'size-10 rounded-lg text-base', name: 'text-base font-semibold' }
			},
			/** Monogram colors: chart tokens, tinted so they read in light and dark */
			tone: {
				0: { tile: 'bg-chart-1/15 text-chart-1' },
				1: { tile: 'bg-chart-2/15 text-chart-2' },
				2: { tile: 'bg-chart-3/20 text-chart-3' },
				3: { tile: 'bg-chart-4/15 text-chart-4' },
				4: { tile: 'bg-chart-5/15 text-chart-5' }
			}
		},
		defaultVariants: { size: 'sm' }
	});

	export type ServiceLogoSize = VariantProps<typeof serviceLogoVariants>['size'];

	/** Same name, same color: a small string hash over the five monogram tones */
	export function monogramTone(name: string): 0 | 1 | 2 | 3 | 4 {
		let hash = 0;
		for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
		return (hash % 5) as 0 | 1 | 2 | 3 | 4;
	}

	/** First letter or digit of the name (`mcp.acme.dev` → `M`, `2fa` → `2`) */
	export const monogram = (name: string) =>
		(name.match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toLocaleUpperCase('en');
</script>

<script lang="ts">
	/**
	 * The logo of a service (connector, directory server) next to or instead of its name: the
	 * icon Toolkien serves (directory icon, or the favicon fetched from the server), else a
	 * monogram with a color derived from the name. Images are decorative: the name is always
	 * there as text (`withName`) or in the surrounding row.
	 */
	type Props = {
		name: string;
		/** Icon URL served by Toolkien (`ConnectorSummary.icon`, `DirectoryEntry.icon`) */
		src?: string | null;
		size?: ServiceLogoSize;
		/** Render the name after the logo */
		withName?: boolean;
	};

	let { name, src = null, size, withName = false }: Props = $props();

	let failed = $state<string | null>(null);
	const image = $derived(src && failed !== src ? src : null);
	/**
	 * Falls back to the monogram when the image fails. An attachment instead of `onerror`: an
	 * event attribute would be rendered inline by SSR, which the CSP blocks. It also catches an
	 * error that happened before hydration (`complete` with no pixels).
	 */
	const watchFailure = (url: string) => (img: HTMLImageElement) => {
		const fail = () => (failed = url);
		if (img.complete && img.naturalWidth === 0) fail();
		img.addEventListener('error', fail);
		return () => img.removeEventListener('error', fail);
	};
	const styles = $derived(
		serviceLogoVariants({ size, tone: image ? undefined : monogramTone(name) })
	);
</script>

<span class={styles.root()} data-slot="service-logo">
	<span class={styles.tile()} aria-hidden="true">
		{#if image}
			<img
				src={image}
				alt=""
				class={styles.image()}
				loading="lazy"
				decoding="async"
				{@attach watchFailure(image)}
			/>
		{:else}
			{monogram(name)}
		{/if}
	</span>
	{#if withName}<span class={styles.name()}>{name}</span>{/if}
</span>
