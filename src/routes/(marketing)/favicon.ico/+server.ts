import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/**
 * Browsers and crawlers request `/favicon.ico` whatever the page links (the layout links
 * `/icon.svg`). Clients that ask for the legacy path may not render SVG, so it points to the
 * PNG icon from `static/` (PNG favicons work everywhere, no `.ico` needed).
 */
export const GET: RequestHandler = () => redirect(301, '/icon-192.png');
