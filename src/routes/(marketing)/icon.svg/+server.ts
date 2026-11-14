import { brand } from '#lib/brand.ts';
import type { RequestHandler } from './$types';

/** Neutral monogram icon (no Tolkien imagery), used by the web manifest */
export const GET: RequestHandler = () =>
	new Response(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#171717"/><text x="32" y="43" font-family="ui-sans-serif,system-ui,sans-serif" font-size="34" font-weight="600" text-anchor="middle" fill="#ffffff">${brand.name.charAt(0)}</text></svg>`,
		{ headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' } }
	);
