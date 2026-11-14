import { describe, expect, it } from 'vitest';
import {
	addLabel,
	authHint,
	categoryLabel,
	directoryFilters,
	filterDirectory,
	POPULAR,
	type DirectoryItem
} from './service-directory.ts';

const item = (patch: Partial<DirectoryItem> & { id: string }): DirectoryItem => ({
	name: patch.id,
	description: 'A server.',
	category: 'other',
	tags: [],
	popular: false,
	publisher: 'official',
	authType: 'oauth',
	supported: true,
	verification: { status: 'documented', by: 'x', on: '2026-11-14' },
	...patch
});

const entries = [
	item({ id: 'zeta', name: 'Zeta', category: 'data' }),
	item({ id: 'linear', name: 'Linear', category: 'project-management', popular: true }),
	item({ id: 'notion', name: 'Notión', category: 'knowledge', tags: ['wiki'], popular: true }),
	item({ id: 'acme', name: 'Acme', category: 'data', tagline: 'Warehouse queries' })
];

describe('directory presentation', () => {
	it('lists popular entries first, then by name', () => {
		expect(filterDirectory(entries, {}).map((e) => e.id)).toEqual([
			'linear',
			'notion',
			'acme',
			'zeta'
		]);
	});

	it('filters by popular or category and searches every text field, accent-insensitive', () => {
		expect(filterDirectory(entries, { filter: POPULAR }).map((e) => e.id)).toEqual([
			'linear',
			'notion'
		]);
		expect(filterDirectory(entries, { filter: 'data' }).map((e) => e.id)).toEqual(['acme', 'zeta']);
		expect(filterDirectory(entries, { search: 'notion WIKI' }).map((e) => e.id)).toEqual([
			'notion'
		]);
		expect(filterDirectory(entries, { search: 'warehouse' }).map((e) => e.id)).toEqual(['acme']);
		expect(filterDirectory(entries, { search: 'project management' })[0].id).toBe('linear');
		expect(filterDirectory(entries, { search: 'nothing here' })).toEqual([]);
	});

	it('builds the chips: All, Popular, then categories in a stable order with counts', () => {
		expect(directoryFilters(entries)).toEqual([
			{ value: '', label: 'All', count: 4 },
			{ value: POPULAR, label: 'Popular', count: 2 },
			{ value: 'data', label: 'Data & analytics', count: 2 },
			{ value: 'project-management', label: 'Project management', count: 1 },
			{ value: 'knowledge', label: 'Docs & knowledge', count: 1 }
		]);
		expect(directoryFilters([item({ id: 'a' })]).map((c) => c.label)).toEqual(['All', 'Other']);
	});

	it('words auth and the add button in user terms', () => {
		expect(authHint('oauth', 'Linear').label).toBe('Sign in with Linear');
		expect(authHint('token', 'GitHub').label).toBe('API key');
		expect(authHint('none', 'Exa').label).toBe('No sign-in');
		expect(addLabel('oauth', 'Linear')).toBe('Add and sign in with Linear');
		expect(addLabel('none', 'Exa')).toBe('Add');
		expect(categoryLabel('brand-new')).toBe('Brand new');
	});
});
