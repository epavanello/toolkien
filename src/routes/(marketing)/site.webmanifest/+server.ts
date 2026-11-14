import { brand } from '#lib/brand.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () =>
	new Response(
		JSON.stringify({
			name: `${brand.name}: ${brand.tagline}`,
			short_name: brand.name,
			description: 'One remote MCP server for all of yours, in code mode.',
			start_url: '/',
			scope: '/',
			display: 'standalone',
			background_color: '#ffffff',
			theme_color: '#ffffff',
			icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
			lang: 'en',
			dir: 'ltr'
		}),
		{
			headers: {
				'Content-Type': 'application/manifest+json',
				'Cache-Control': 'public, max-age=86400'
			}
		}
	);
