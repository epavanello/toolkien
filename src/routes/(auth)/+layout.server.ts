import { redirect } from '@sveltejs/kit';
import { safeRedirectPath } from '#lib/core/redirects.ts';
import { googleSignInEnabled } from '#lib/server/auth.ts';
import type { LayoutServerLoad } from './$types';

/** Routes of this group a signed-in user can still open (consent needs a session) */
const OPEN_WHEN_SIGNED_IN = new Set(['/(auth)/consent']);

export const load: LayoutServerLoad = ({ locals, route, url }) => {
	if (locals.user && !OPEN_WHEN_SIGNED_IN.has(route.id ?? '')) {
		redirect(303, safeRedirectPath(url.searchParams.get('redirectTo')));
	}
	return {
		redirectTo: safeRedirectPath(url.searchParams.get('redirectTo')),
		googleSignIn: googleSignInEnabled,
		/** Set by Better Auth when a Google sign-in fails (`errorCallbackURL`) */
		signInError: url.searchParams.get('error')
	};
};
