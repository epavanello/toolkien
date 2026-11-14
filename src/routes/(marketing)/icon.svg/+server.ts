import { BRAND_HEX, MARK_RINGS, ringsSvg } from '#lib/components/brand/paths.ts';
import type { RequestHandler } from './$types';

/**
 * Favicon and manifest icon: the interlocking rings (paper + ember) on the ink tile. Same
 * geometry as the in-app logo (`#lib/components/brand`), so the two never drift.
 */
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${BRAND_HEX.ink}"/>${ringsSvg(MARK_RINGS, { a: BRAND_HEX.paper, b: BRAND_HEX.ember }, 'tk')}</svg>`;

export const GET: RequestHandler = () =>
	new Response(svg, {
		headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' }
	});
