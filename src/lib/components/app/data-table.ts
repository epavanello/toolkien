import type { Component, Snippet } from 'svelte';
import type { BadgeVariant } from '#lib/components/ui/badge/badge.svelte';
import type { ActionItem } from './actions-menu.svelte';
import type { FilterDefinition } from './filter-bar.svelte';

/**
 * Column of a `DataTable`. `type` picks a standard cell; `cell` is the escape hatch for a cell
 * no type covers (prefer adding a type here when it recurs).
 */
export type Column<T> = {
	key: string;
	header: string;
	type?: 'text' | 'mono' | 'badge' | 'status' | 'datetime' | 'number' | 'actions';
	/** Value for text/mono/badge/status/datetime/number cells (default: `row[key]`) */
	value?: (row: T) => unknown;
	/** `badge` cells */
	badgeVariant?: (row: T) => BadgeVariant;
	/** `actions` cells */
	actions?: (row: T) => ActionItem[];
	cell?: Snippet<[T]>;
	/**
	 * A service logo before the value of a text cell (`ServiceLogo`): the icon URL Toolkien
	 * serves, `null` for the monogram of the value
	 */
	logo?: (row: T) => string | null | undefined;
	/**
	 * A small button after the cell value (e.g. "Connect" next to a pending status); `null`
	 * hides it. Clicks do not open the row.
	 */
	inlineAction?: (row: T) => InlineAction | null;
	/** Included in the built-in search (default: text and mono columns) */
	searchable?: boolean;
	/** Hidden below the `md` breakpoint */
	hideOnMobile?: boolean;
};

export type InlineAction = {
	label: string;
	icon?: Component;
	onSelect: () => unknown;
	/** `primary` for the action the row is waiting for, `outline` (default) otherwise */
	variant?: 'primary' | 'outline';
};

/** Group header of a grouped `DataTable`: a label, optionally with the service logo */
export type TableGroup = { label: string; logo?: string | null };

export type TableFilter<T> = FilterDefinition & { match: (row: T, value: string) => boolean };

export const cellValue = <T>(column: Column<T>, row: T): unknown =>
	column.value ? column.value(row) : (row as Record<string, unknown>)[column.key];

/** Rows matching the search text (any searchable column) and every active filter */
export function filterRows<T>(
	rows: T[],
	columns: Column<T>[],
	search: string,
	filters: TableFilter<T>[],
	values: Record<string, string>
): T[] {
	const query = search.trim().toLowerCase();
	const searchable = columns.filter(
		(column) =>
			column.searchable ?? (!column.type || column.type === 'text' || column.type === 'mono')
	);
	return rows.filter(
		(row) =>
			(!query ||
				searchable.some((column) =>
					String(cellValue(column, row) ?? '')
						.toLowerCase()
						.includes(query)
				)) &&
			filters.every((filter) => !values[filter.key] || filter.match(row, values[filter.key]))
	);
}

/** Page `page` (1-based) of `rows`, clamped to the last page */
export function paginate<T>(rows: T[], page: number, pageSize: number) {
	const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
	const current = Math.min(Math.max(1, page), pageCount);
	return {
		rows: rows.slice((current - 1) * pageSize, current * pageSize),
		page: current,
		pageCount,
		from: rows.length === 0 ? 0 : (current - 1) * pageSize + 1,
		to: Math.min(current * pageSize, rows.length)
	};
}

/**
 * Stable sort by group label (empty labels last), so a grouped table shows each group's rows
 * together; `withHeaders` marks the first row of every group on the current page.
 */
export function sortByGroup<T>(
	rows: T[],
	group: ((row: T) => string | TableGroup) | undefined
): T[] {
	if (!group) return rows;
	return rows
		.map((row, index) => ({ row, index, key: groupLabel(group(row)) }))
		.sort((a, b) =>
			a.key === b.key ? a.index - b.index : !a.key ? 1 : !b.key ? -1 : a.key.localeCompare(b.key)
		)
		.map((entry) => entry.row);
}

const groupLabel = (group: string | TableGroup) =>
	typeof group === 'string' ? group : group.label;

/** Group header to render above `rows[index]`, or `null` when it continues the previous group */
export function groupHeaderAt<T>(
	rows: T[],
	index: number,
	group: ((row: T) => string | TableGroup) | undefined
): TableGroup | null {
	if (!group) return null;
	const value = group(rows[index]);
	const header = typeof value === 'string' ? { label: value } : value;
	return index === 0 || groupLabel(group(rows[index - 1])) !== header.label ? header : null;
}
