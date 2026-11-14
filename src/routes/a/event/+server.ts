import { analyticsEnabled, buildEvent, forwardEvent } from '#lib/server/analytics.ts';
import type { RequestHandler } from './$types';

const MAX_BODY_BYTES = 4096;

/** Analytics events, sanitized and forwarded to Plausible (see `#lib/server/analytics.ts`) */
export const POST: RequestHandler = async ({ request, url, getClientAddress }) => {
	if (!analyticsEnabled()) return new Response(null, { status: 404 });
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
	let input: unknown;
	try {
		input = JSON.parse(text);
	} catch {
		return new Response(null, { status: 400 });
	}
	const body =
		input && typeof input === 'object'
			? buildEvent(input as Record<string, unknown>, url.origin)
			: null;
	// Dropped events still answer 202: the tracker has nothing useful to do with an error
	if (!body) return new Response(null, { status: 202 });
	const status = await forwardEvent(body, {
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent') ?? ''
	}).catch(() => 502);
	return new Response(null, { status: status >= 200 && status < 300 ? 202 : 502 });
};
