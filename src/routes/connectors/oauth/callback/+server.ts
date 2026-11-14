import { redirect } from '@sveltejs/kit';
import { abandonOAuth, completeOAuth, handleOAuthCallback } from '#lib/server/connectors/index.ts';
import type { RequestHandler } from './$types';

/**
 * Upstream OAuth redirect target (`${ORIGIN}/connectors/oauth/callback`). The signed-in user
 * must be the one who started the flow; the code is exchanged server side and the tokens are
 * sealed. Every failure of a known flow goes back to the connector with `?oauth=<code>` (see
 * `handleOAuthCallback`); error details from the authorization server are never echoed.
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
	}
	const location = await handleOAuthCallback(url.searchParams, locals.user.id, {
		complete: completeOAuth,
		abandon: abandonOAuth,
		log: (code) => console.warn(`[connectors] upstream OAuth callback: ${code}`)
	});
	redirect(303, location);
};
