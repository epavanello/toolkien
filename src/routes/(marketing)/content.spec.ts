import { describe, expect, it } from 'vitest';
import { docsMarkdown, legalMarkdown, splitFrontmatter } from './content.ts';
import { DOCS_PAGES } from './docs/nav.ts';
import { LEGAL_DOCUMENTS, publicPages } from './site.ts';

describe('public content', () => {
	it('splits frontmatter', () => {
		expect(splitFrontmatter('---\ntitle: Hello\nupdated: 2026-11-14\n---\n\nBody')).toEqual({
			title: 'Hello',
			body: 'Body'
		});
		expect(splitFrontmatter('No frontmatter')).toEqual({ title: null, body: 'No frontmatter' });
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
});
