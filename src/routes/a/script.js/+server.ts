import { trackerScript } from '#lib/server/analytics.ts';
import type { RequestHandler } from './$types';

/** First-party copy of the Plausible tracker (see `#lib/server/analytics.ts`) */
export const GET: RequestHandler = async () => {
	const script = await trackerScript().catch(() => null);
	if (!script) return new Response('Not found', { status: 404 });
	return new Response(script, {
		headers: {
			'Content-Type': 'application/javascript; charset=utf-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
