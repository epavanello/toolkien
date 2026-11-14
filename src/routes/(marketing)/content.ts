import { DOCS_PAGES } from './docs/nav.ts';
import { LEGAL_DOCUMENTS } from './site.ts';

/**
 * Raw markdown of the docs and legal drafts, bundled at build time, for `llms-full.txt`.
 * Frontmatter is stripped; the title becomes a heading.
 */
const docs = import.meta.glob<string>('./docs/**/+page.md', {
	query: '?raw',
	import: 'default',
	eager: true
});
const legal = import.meta.glob<string>('/legal/*.md', {
	query: '?raw',
	import: 'default',
	eager: true
});

/** Pure: `---\ntitle: X\n---\nbody` → `{ title: 'X', body }` */
export function splitFrontmatter(source: string): { title: string | null; body: string } {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
	if (!match) return { title: null, body: source.trim() };
	const title = /^title:\s*(.+)$/m.exec(match[1])?.[1]?.trim() ?? null;
	return { title, body: source.slice(match[0].length).trim() };
}

const docsFile = (href: string) =>
	`./docs${href.slice('/docs'.length)}/+page.md`.replace('//', '/');

export function docsMarkdown(): { href: string; title: string; body: string }[] {
	return DOCS_PAGES.flatMap((page) => {
		const source = docs[docsFile(page.href)];
		if (!source) return [];
		const { title, body } = splitFrontmatter(source);
		return [{ href: page.href, title: title ?? page.label, body }];
	});
}

export function legalMarkdown(): { href: string; title: string; body: string }[] {
	return LEGAL_DOCUMENTS.flatMap((doc) => {
		const source = legal[`/legal/${doc.slug}.md`];
		if (!source) return [];
		const { title, body } = splitFrontmatter(source);
		return [{ href: `/legal/${doc.slug}`, title: title ?? doc.label, body }];
	});
}
