import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from 'mdsvex';
import { describe, expect, it } from 'vitest';
import { docsMarkdown, lastModified, legalMarkdown, splitFrontmatter } from './content.ts';
import { DOCS_PAGES } from './docs/nav.ts';
import { LEGAL_DOCUMENTS, publicPages } from './site.ts';

describe('public content', () => {
	it('splits frontmatter', () => {
		expect(splitFrontmatter('---\ntitle: Hello\nupdated: 2026-11-14\n---\n\nBody')).toEqual({
			title: 'Hello',
			updated: '2026-11-14',
			body: 'Body'
		});
		expect(splitFrontmatter('No frontmatter')).toEqual({
			title: null,
			updated: null,
			body: 'No frontmatter'
		});
	});

	it('has a markdown page for every docs nav entry', () => {
		expect(docsMarkdown().map((page) => page.href)).toEqual(DOCS_PAGES.map((page) => page.href));
	});

	it('starts every legal draft with the review disclaimer', () => {
		const docs = legalMarkdown();
		expect(docs).toHaveLength(LEGAL_DOCUMENTS.length);
		for (const doc of docs) {
			expect(doc.body.split('\n')[0]).toContain(
				'Draft generated automatically: to be reviewed by a lawyer or DPO before publication.'
			);
		}
	});

	it('lists docs and legal pages in the sitemap', () => {
		const paths = publicPages().map((page) => page.path);
		expect(paths).toContain('/docs/security');
		expect(paths).toContain('/legal/privacy');
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('gives every docs and legal page a lastmod and a unique title', () => {
		const pages = [...docsMarkdown(), ...legalMarkdown()];
		const modified = lastModified();
		for (const page of pages)
			expect(modified.get(page.href), page.href).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		const titles = pages.map((page) => page.title);
		expect(new Set(titles).size).toBe(titles.length);
	});

	it('has valid frontmatter (title and description) in every markdown page', async () => {
		const files = [
			...readdirSync('src/routes/(marketing)', { recursive: true, encoding: 'utf8' })
				.filter((file) => file.endsWith('.md'))
				.map((file) => join('src/routes/(marketing)', file)),
			...readdirSync('legal')
				.filter((file) => file.endsWith('.md'))
				.map((file) => join('legal', file))
		];
		expect(files.length).toBeGreaterThan(5);
		for (const file of files) {
			// A YAML error (e.g. an unquoted `: ` in a description) silently drops every field
			const result = await compile(readFileSync(file, 'utf8'), { highlight: false });
			const fm = (result?.data?.fm ?? {}) as Record<string, unknown>;
			expect(typeof fm.title, file).toBe('string');
			expect(typeof fm.description, file).toBe('string');
		}
	});
});
