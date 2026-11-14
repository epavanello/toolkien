import type { RequestHandler } from './$types';

/** App surfaces stay out of crawlers; public pages (landing, docs, legal) are open */
const DISALLOWED = [
	'/w/',
	'/admin',
	'/approve',
	'/invite/',
	'/consent',
	'/two-factor',
	'/api/',
	'/mcp'
];

export const GET: RequestHandler = ({ url }) =>
	new Response(
		[
			'User-agent: *',
			'Allow: /',
			...DISALLOWED.map((path) => `Disallow: ${path}`),
			'',
			`Sitemap: ${url.origin}/sitemap.xml`,
			''
		].join('\n'),
		{
			headers: {
				'Content-Type': 'text/plain; charset=utf-8',
				'Cache-Control': 'public, max-age=86400'
			}
		}
	);
