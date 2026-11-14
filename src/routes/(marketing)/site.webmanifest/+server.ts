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
			// PNGs rendered by scripts/brand-images.ts (installability needs 192 and 512)
			icons: [
				{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
				{ src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
				{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
				{ src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
			],
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
