import { lastModified } from '../content.ts';
import { publicPages } from '../site.ts';
import type { RequestHandler } from './$types';

const escapeXml = (value: string) =>
	value.replace(
		/[<>&'"]/g,
		(c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[c]};`
	);

export const GET: RequestHandler = ({ url }) => {
	const modified = lastModified();
	const urls = publicPages()
		.map((page) => {
			// Same URL as the page's canonical link (`/` keeps its slash)
			const loc = `<loc>${escapeXml(`${url.origin}${page.path}`)}</loc>`;
			const lastmod = modified.has(page.path)
				? `<lastmod>${modified.get(page.path)}</lastmod>`
				: '';
			return `  <url>${loc}${lastmod}<priority>${page.priority.toFixed(1)}</priority></url>`;
		})
		.join('\n');
	return new Response(
		`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
		{
			headers: {
				'Content-Type': 'application/xml; charset=utf-8',
				'Cache-Control': 'public, max-age=3600'
			}
		}
	);
};
