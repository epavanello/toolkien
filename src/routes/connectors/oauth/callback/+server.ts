import { redirect } from '@sveltejs/kit';
import { safeRedirectPath } from '#lib/core/redirects.ts';
import { abandonOAuth, completeOAuth } from '#lib/server/connectors/index.ts';
import type { RequestHandler } from './$types';

const withParam = (path: string, key: string, value: string) =>
	`${path}${path.includes('?') ? '&' : '?'}${key}=${value}`;

/**
 * Upstream OAuth redirect target (`${ORIGIN}/connectors/oauth/callback`). The signed-in user
 * must be the one who started the flow; the code is exchanged server side and the tokens are
 * sealed. Error details from the authorization server are never echoed (mix-up attacks).
 */
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
	}
	const state = url.searchParams.get('state') ?? '';
	const code = url.searchParams.get('code');
	if (!state) redirect(303, '/');
	if (!code) {
		const returnTo = await abandonOAuth(state, locals.user.id);
		redirect(303, withParam(safeRedirectPath(returnTo), 'oauth', 'denied'));
	}
	const done = await completeOAuth(state, code, {
		userId: locals.user.id,
		iss: url.searchParams.get('iss') ?? undefined
	});
	redirect(303, withParam(safeRedirectPath(done.returnTo), 'oauth', 'connected'));
};
