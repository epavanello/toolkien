<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const logoVariants = tv({
		slots: {
			root: 'inline-flex shrink-0 items-center text-foreground',
			mark: 'shrink-0',
			tile: 'flex shrink-0 items-center justify-center bg-ink dark:ring-1 dark:ring-border',
			wordmark: 'w-auto shrink-0'
		},
		variants: {
			/** Height: `sm` app chrome, `md` site header, `lg` auth, `xl` hero and covers */
			size: {
				sm: { mark: 'size-5', tile: 'size-6 rounded-sm', wordmark: 'h-[1.05rem]' },
				md: { mark: 'size-6', tile: 'size-7 rounded-md', wordmark: 'h-[1.3rem]' },
				lg: { mark: 'size-8', tile: 'size-9 rounded-md', wordmark: 'h-7' },
				xl: { mark: 'size-14', tile: 'size-16 rounded-xl', wordmark: 'h-14' }
			}
		},
		defaultVariants: { size: 'md' }
	});

	export type LogoSize = VariantProps<typeof logoVariants>['size'];
</script>

<script lang="ts">
	import { brand } from '#lib/brand.ts';
	import { MARK_RINGS, WORDMARK } from './paths.ts';
	import Rings from './rings.svelte';

	/**
	 * The Toolkien logo. `wordmark`: `Toolkien` with the double o drawn as two interlocking rings
	 * (the right one in ember). `mark`: the rings alone (favicon, collapsed sidebar); `tile` puts
	 * them on the ink tile of the app icon. One accessible name; the SVG itself is decorative.
	 */
	type Props = {
		variant?: 'wordmark' | 'mark';
		size?: LogoSize;
		tile?: boolean;
		/** Accessible name; pass `''` when the surrounding link or text already names it */
		label?: string;
		class?: string;
	};

	let {
		variant = 'wordmark',
		size,
		tile = false,
		label = brand.name,
		class: className
	}: Props = $props();

	const styles = $derived(logoVariants({ size }));
</script>

<span
	class={styles.root({ class: className })}
	role={label ? 'img' : undefined}
	aria-label={label || undefined}
	aria-hidden={label ? undefined : 'true'}
	data-slot="logo"
>
	{#if variant === 'mark'}
		{#if tile}
			<span class={styles.tile()}>
				<svg viewBox="0 0 32 32" class="size-full" aria-hidden="true">
					<Rings geometry={MARK_RINGS} a="var(--paper)" b="var(--ember)" />
				</svg>
			</span>
		{:else}
			<svg viewBox="0 0 32 32" class={styles.mark()} aria-hidden="true">
				<Rings geometry={MARK_RINGS} a="currentColor" b="var(--primary)" />
			</svg>
		{/if}
	{:else}
		<svg
			viewBox={WORDMARK.viewBox}
			class={styles.wordmark()}
			style:aspect-ratio={WORDMARK.ratio}
			aria-hidden="true"
		>
			<path d={WORDMARK.letters} fill="currentColor" />
			<Rings geometry={WORDMARK.rings} a="currentColor" b="var(--primary)" />
		</svg>
	{/if}
</span>
