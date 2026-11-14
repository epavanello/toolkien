import { publicPages } from '../site.ts';
import type { RequestHandler } from './$types';

const escapeXml = (value: string) =>
	value.replace(
		/[<>&'"]/g,
		(c) => `&${{ '<': 'lt', '>': 'gt', '&': 'amp', "'": 'apos', '"': 'quot' }[c]};`
	);

export const GET: RequestHandler = ({ url }) => {
	const urls = publicPages()
		.map(
			(page) =>
				`  <url><loc>${escapeXml(`${url.origin}${page.path === '/' ? '' : page.path}`)}</loc><priority>${page.priority.toFixed(1)}</priority></url>`
		)
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
