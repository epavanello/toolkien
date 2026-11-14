import { error } from '@sveltejs/kit';
import { readConnectorIcon } from '#lib/server/connectors/index.ts';
import type { RequestHandler } from './$types';

/**
 * The favicon fetched from a free-URL connector's server (`?v=` = fetch time, for caching).
 * Untrusted bytes: served only as a raster type recognised from the content, with `nosniff`
 * and a CSP that forbids everything, to signed-in members who can see the connector.
 */
export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in to continue.', { code: 'UNAUTHORIZED' });
	const icon = await readConnectorIcon(locals.user.id, params.id);
	return new Response(new Uint8Array(icon.data), {
		headers: {
			'content-type': icon.contentType,
			'content-length': String(icon.data.byteLength),
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox",
			'cross-origin-resource-policy': 'same-origin',
			'cache-control': 'private, max-age=604800, immutable'
		}
	});
};
