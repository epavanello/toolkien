<script lang="ts" module>
	export type CategoryOption = { value: string; label: string; count?: number };
</script>

<script lang="ts">
	/**
	 * One-choice filter as a row of chips ("All", "Popular", categories) with optional counts.
	 * Toggle buttons (`aria-pressed`); the row scrolls sideways on narrow screens instead of
	 * wrapping into a wall of chips.
	 */
	type Props = { label: string; options: CategoryOption[]; value?: string };

	let { label, options, value = $bindable('') }: Props = $props();
</script>

<div
	role="group"
	aria-label={label}
	class="-mx-4 flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
	data-slot="category-filter"
>
	{#each options as option (option.value)}
		{@const pressed = option.value === value}
		<button
			type="button"
			aria-pressed={pressed}
			onclick={() => (value = option.value)}
			class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:border-foreground aria-pressed:bg-foreground aria-pressed:text-background"
		>
			{option.label}
			{#if option.count !== undefined}
				<span class="tabular-nums opacity-60">{option.count}</span>
			{/if}
		</button>
	{/each}
</div>
