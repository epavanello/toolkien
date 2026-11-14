import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addServerUrl } from '../../../routes/w/[workspace]/directory/directory.ts';
import { directoryShowcase, findDirectoryEntryByUrl, listDirectoryEntries } from './directory.ts';
import {
	directoryJsonSchema,
	isSupportedEntry,
	isTrustedEntry,
	iconProblem,
	normalizeServerUrl,
	validateDirectory
} from './directory-schema.ts';

const root = join(process.cwd(), 'directory');
const files = readdirSync(join(root, 'servers')).map((name) => ({
	name,
	content: readFileSync(join(root, 'servers', name), 'utf8')
}));

const icons = new Map(
	readdirSync(join(root, 'icons')).map((name) => [
		name,
		new Uint8Array(readFileSync(join(root, 'icons', name)))
	])
);

const valid = {
	id: 'acme',
	name: 'Acme',
	description: 'Acme tools for testing.',
	url: 'https://mcp.acme.example/mcp',
	namespace: 'acme',
	publisher: 'official',
	category: 'other',
	auth: { type: 'none' },
	verification: { status: 'documented', by: 'someone', on: '2026-11-14' }
};
const file = (entry: object, name = 'acme.json') => ({ name, content: JSON.stringify(entry) });

describe('curated directory (CI gate for contributions)', () => {
	it('every entry is valid', () => {
		const { entries, issues } = validateDirectory(files, icons);
		expect(issues).toEqual([]);
		expect(entries.length).toBeGreaterThanOrEqual(10);
	});

	it('icons are committed square PNGs, referenced by path, never remote URLs', () => {
		const png = icons.get('linear.png')!;
		expect(iconProblem(png)).toBeNull();
		expect(iconProblem(new TextEncoder().encode('<svg/>'))).toBe('Not a PNG file.');
		expect(iconProblem(new Uint8Array(40 * 1024))).toMatch(/Larger than/);
		const wide = png.slice();
		new DataView(wide.buffer).setUint32(16, 200);
		expect(iconProblem(wide)).toMatch(/Not square/);

		const check = (icon: string, available = icons) =>
			validateDirectory([file({ ...valid, icon })], available).issues.map((i) => i.message);
		expect(check('https://acme.example/logo.png')[0]).toMatch(/icons\/<id>\.png/);
		expect(check('icons/acme.svg')[0]).toMatch(/icons\/<id>\.png/);
		expect(check('icons/acme.png', new Map())).toEqual([
			'icon: File not found in directory/icons/.'
		]);
		expect(validateDirectory([file(valid)], new Map([['orphan.png', png]])).issues).toEqual([
			{ file: 'icons/orphan.png', message: 'Not used by any entry.' }
		]);
	});

	it('bundles every icon as a URL served by Toolkien', () => {
		for (const entry of listDirectoryEntries()) {
			expect(entry.icon).toMatch(/^(data:image\/png;base64,|\/.*\.png$)/);
		}
	});

	it('schema.json is in sync with the zod schema', () => {
		const committed = JSON.parse(readFileSync(join(root, 'schema.json'), 'utf8'));
		expect(committed).toEqual(JSON.parse(JSON.stringify(directoryJsonSchema())));
	});

	it('names the maintainer of every community entry', () => {
		const entries = listDirectoryEntries();
		expect(entries.filter((e) => e.publisher === 'official').length).toBeGreaterThan(50);
		for (const entry of entries.filter((e) => e.publisher === 'community'))
			expect(entry.verification.notes, entry.id).toMatch(/maintained by/i);
	});

	it('gives every entry a tagline, examples and an icon (presentable cards)', () => {
		for (const entry of listDirectoryEntries()) {
			expect(entry.tagline, entry.id).toBeTruthy();
			expect(entry.examples.length, entry.id).toBeGreaterThan(0);
			expect(entry.icon, entry.id).toBeTruthy();
		}
		expect(listDirectoryEntries().filter((e) => e.popular).length).toBeGreaterThanOrEqual(8);
	});

	it('marks servers that only accept pre-registered OAuth clients as not supported', () => {
		const asana = listDirectoryEntries().find((e) => e.id === 'asana')!;
		expect(asana.supported).toBe(false);
		expect(isSupportedEntry({ auth: { type: 'oauth', oauth: { registration: ['dcr'] } } })).toBe(
			true
		);
		expect(isSupportedEntry({ auth: { type: 'token' } })).toBe(true);
		expect(directoryShowcase().servers.every((s) => s.icon)).toBe(true);
		expect(directoryShowcase().total).toBe(listDirectoryEntries().length);
	});

	it('the "Add it yourself" template only needs filling in', () => {
		const url = new URL(addServerUrl('Acme Tools'));
		expect(url.searchParams.get('filename')).toBe('acme-tools.json');
		const { issues } = validateDirectory([
			{ name: 'acme-tools.json', content: url.searchParams.get('value')! }
		]);
		expect(issues).toEqual([]);
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
		['bad date', { verification: { status: 'tested', by: 'x', on: 'yesterday' } }],
		['legacy status', { verification: { status: 'verified', by: 'x', on: '2026-11-14' } }],
		['missing publisher', { publisher: undefined }],
		['unknown publisher', { publisher: 'vendor' }],
		[
			'needs-review without notes',
			{ verification: { status: 'needs-review', by: 'x', on: '2026-11-14' } }
		],
		['unknown annotation', { tools: { a: { annotations: { readOnly: true } } } }],
		['tagline too long', { tagline: 'x'.repeat(81) }],
		[
			'too many examples',
			{ examples: ['a prompt', 'b prompt', 'c prompt', 'd prompt', 'e prompt', 'f prompt'] }
		],
		['unknown category', { category: 'games' }]
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

describe('trust and URL matching', () => {
	it('trusts official entries that were checked', () => {
		const entry = (publisher: 'official' | 'community', status: 'tested' | 'needs-review') => ({
			publisher,
			verification: { status }
		});
		expect(isTrustedEntry(entry('official', 'tested'))).toBe(true);
		expect(isTrustedEntry(entry('official', 'needs-review'))).toBe(false);
		expect(isTrustedEntry(entry('community', 'tested'))).toBe(false);
	});

	it('matches endpoints ignoring case, trailing slash and hash', () => {
		expect(normalizeServerUrl('https://MCP.PostHog.com/mcp/#x')).toBe(
			'https://mcp.posthog.com/mcp'
		);
		expect(findDirectoryEntryByUrl('https://mcp.posthog.com/MCP/')?.id).toBe('posthog');
		expect(findDirectoryEntryByUrl('https://mcp.posthog.com/mcp?x=1')).toBeNull();
		expect(findDirectoryEntryByUrl('not a url')).toBeNull();
	});
});
