<script lang="ts" module>
	export type FilterOption = { value: string; label: string };

	/** A select filter; `''` (the "All" option) means not filtered */
	export type FilterDefinition = { key: string; label: string; options: FilterOption[] };
</script>

<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import type { Snippet } from 'svelte';
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import Toolbar from './toolbar.svelte';

	/**
	 * Search box + select filters above a list. Values are bindable; `DataTable` uses it
	 * internally, pages use it directly only for lists that are not tables.
	 */
	type Props = {
		search?: string;
		/** `false` hides the search box (filters only) */
		searchable?: boolean;
		searchPlaceholder?: string;
		filters?: FilterDefinition[];
		values?: Record<string, string>;
		end?: Snippet;
	};

	let {
		search = $bindable(''),
		searchable = true,
		searchPlaceholder = 'Search…',
		filters = [],
		values = $bindable({}),
		end
	}: Props = $props();
</script>

<Toolbar {end}>
	{#if searchable}
		<InputGroup.Root class="h-8 w-full max-w-xs">
			<InputGroup.Addon><Search /></InputGroup.Addon>
			<InputGroup.Input
				type="search"
				bind:value={search}
				placeholder={searchPlaceholder}
				aria-label={searchPlaceholder}
			/>
		</InputGroup.Root>
	{/if}
	{#each filters as filter (filter.key)}
		<NativeSelect.Root
			size="sm"
			aria-label={filter.label}
			value={values[filter.key] ?? ''}
			onchange={(event) => (values = { ...values, [filter.key]: event.currentTarget.value })}
		>
			<NativeSelect.Option value="">{filter.label}: All</NativeSelect.Option>
			{#each filter.options as option (option.value)}
				<NativeSelect.Option value={option.value}>{option.label}</NativeSelect.Option>
			{/each}
		</NativeSelect.Root>
	{/each}
</Toolbar>
