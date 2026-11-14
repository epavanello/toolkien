import { PRIVATE_PREFIXES } from '#lib/server/robots.ts';
import type { RequestHandler } from './$types';

/**
 * App surfaces stay out of crawlers (same list as the `X-Robots-Tag` header in hooks); public
 * pages (landing, docs, legal) are open
 */
const DISALLOWED = PRIVATE_PREFIXES;

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
