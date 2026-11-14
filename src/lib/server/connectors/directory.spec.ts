import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listDirectoryEntries } from './directory.ts';
import { directoryJsonSchema, validateDirectory } from './directory-schema.ts';

const root = join(process.cwd(), 'directory');
const files = readdirSync(join(root, 'servers')).map((name) => ({
	name,
	content: readFileSync(join(root, 'servers', name), 'utf8')
}));

const valid = {
	id: 'acme',
	name: 'Acme',
	description: 'Acme tools for testing.',
	url: 'https://mcp.acme.example/mcp',
	namespace: 'acme',
	category: 'other',
	auth: { type: 'none' },
	verification: { status: 'community', by: 'someone', on: '2026-11-14' }
};
const file = (entry: object, name = 'acme.json') => ({ name, content: JSON.stringify(entry) });

describe('curated directory (CI gate for contributions)', () => {
	it('every entry is valid', () => {
		const { entries, issues } = validateDirectory(files);
		expect(issues).toEqual([]);
		expect(entries.length).toBeGreaterThanOrEqual(10);
	});

	it('schema.json is in sync with the zod schema', () => {
		const committed = JSON.parse(readFileSync(join(root, 'schema.json'), 'utf8'));
		expect(committed).toEqual(JSON.parse(JSON.stringify(directoryJsonSchema())));
	});

	it('the app bundles every file', () => {
		expect(
			listDirectoryEntries()
				.map((e) => e.id)
				.sort()
		).toEqual(files.map((f) => f.name.replace(/\.json$/, '')).sort());
	});
});

describe('validateDirectory', () => {
	it('accepts a minimal entry and applies defaults', () => {
		const { entries, issues } = validateDirectory([file(valid)]);
		expect(issues).toEqual([]);
		expect(entries[0].tags).toEqual([]);
		expect(entries[0].tools).toEqual({});
	});

	it.each([
		['plain http', { url: 'http://mcp.acme.example/mcp' }],
		['credentials in URL', { url: 'https://user:pw@mcp.acme.example/mcp' }],
		['bad id', { id: 'Acme_Tools' }],
		['bad namespace', { namespace: 'Acme-Tools' }],
		['unknown field', { logo: 'https://x' }],
		['oauth hints without oauth', { auth: { type: 'none', scopes: ['read'] } }],
		['bad date', { verification: { status: 'verified', by: 'x', on: 'yesterday' } }],
		['unknown annotation', { tools: { a: { annotations: { readOnly: true } } } }]
	])('rejects %s', (_label, patch) => {
		expect(validateDirectory([file({ ...valid, ...patch })]).issues.length).toBeGreaterThan(0);
	});

	it('requires id = file name and unique ids, namespaces and URLs', () => {
		expect(validateDirectory([file(valid, 'other.json')]).issues[0].message).toContain(
			'match the file name'
		);
		const { issues } = validateDirectory([
			file(valid),
			file({ ...valid, id: 'acme-2', url: 'https://mcp.acme.example/mcp/' }, 'acme-2.json')
		]);
		expect(issues.map((i) => i.message).join('\n')).toMatch(
			/Duplicate namespace[\s\S]*Duplicate url/
		);
	});

	it('reports invalid JSON and non-JSON files', () => {
		expect(validateDirectory([{ name: 'acme.json', content: '{' }]).issues[0].message).toBe(
			'Invalid JSON.'
		);
		expect(validateDirectory([{ name: 'acme.yaml', content: '' }]).issues).toHaveLength(1);
	});
});
