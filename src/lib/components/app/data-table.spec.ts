import { describe, expect, it } from 'vitest';
import { filterRows, paginate, type Column, type TableFilter } from './data-table.ts';
import { humanize, toneFor } from './status.ts';

type Row = { id: string; name: string; status: string };
const rows: Row[] = [
	{ id: '1', name: 'GitHub', status: 'active' },
	{ id: '2', name: 'Gmail', status: 'pending_auth' },
	{ id: '3', name: 'Linear', status: 'active' }
];
const columns: Column<Row>[] = [
	{ key: 'name', header: 'Name' },
	{ key: 'status', header: 'Status', type: 'status' }
];
const filters: TableFilter<Row>[] = [
	{ key: 'status', label: 'Status', options: [], match: (row, value) => row.status === value }
];

describe('data table helpers', () => {
	it('searches text columns only, case-insensitively', () => {
		expect(filterRows(rows, columns, 'gm', [], {}).map((r) => r.id)).toEqual(['2']);
		expect(filterRows(rows, columns, 'active', [], {})).toHaveLength(0);
	});

	it('applies active filters and ignores empty ones', () => {
		expect(filterRows(rows, columns, '', filters, { status: 'active' })).toHaveLength(2);
		expect(filterRows(rows, columns, '', filters, { status: '' })).toHaveLength(3);
	});

	it('paginates and clamps the page', () => {
		expect(paginate(rows, 2, 2)).toMatchObject({ page: 2, pageCount: 2, from: 3, to: 3 });
		expect(paginate(rows, 9, 2).page).toBe(2);
		expect(paginate([], 1, 25)).toMatchObject({ from: 0, to: 0, pageCount: 1 });
	});

	it('maps statuses to tones and labels', () => {
		expect(toneFor('completed')).toBe('success');
		expect(toneFor('pending_auth')).toBe('pending');
		expect(toneFor('whatever')).toBe('neutral');
		expect(humanize('pending_auth')).toBe('Pending auth');
	});
});
