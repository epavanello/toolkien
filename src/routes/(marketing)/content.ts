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

type Frontmatter = { title: string | null; updated: string | null; body: string };

/** Pure: `---\ntitle: X\nupdated: 2026-11-14\n---\nbody` → `{ title: 'X', updated, body }` */
export function splitFrontmatter(source: string): Frontmatter {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
	if (!match) return { title: null, updated: null, body: source.trim() };
	const title = /^title:\s*(.+)$/m.exec(match[1])?.[1]?.trim() ?? null;
	const updated = /^updated:\s*['"]?(\d{4}-\d{2}-\d{2})/m.exec(match[1])?.[1] ?? null;
	return { title, updated, body: source.slice(match[0].length).trim() };
}

type MarkdownPage = { href: string; title: string; updated: string | null; body: string };

const docsFile = (href: string) =>
	`./docs${href.slice('/docs'.length)}/+page.md`.replace('//', '/');

export function docsMarkdown(): MarkdownPage[] {
	return DOCS_PAGES.flatMap((page) => {
		const source = docs[docsFile(page.href)];
		if (!source) return [];
		const { title, updated, body } = splitFrontmatter(source);
		return [{ href: page.href, title: title ?? page.label, updated, body }];
	});
}

export function legalMarkdown(): MarkdownPage[] {
	return LEGAL_DOCUMENTS.flatMap((doc) => {
		const source = legal[`/legal/${doc.slug}.md`];
		if (!source) return [];
		const { title, updated, body } = splitFrontmatter(source);
		return [{ href: `/legal/${doc.slug}`, title: title ?? doc.label, updated, body }];
	});
}

/** `updated` frontmatter of every docs and legal page, by path (sitemap `lastmod`) */
export const lastModified = (): Map<string, string> =>
	new Map(
		[...docsMarkdown(), ...legalMarkdown()].flatMap((page) =>
			page.updated ? [[page.href, page.updated] as const] : []
		)
	);
