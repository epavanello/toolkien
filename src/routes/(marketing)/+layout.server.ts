import type { LayoutServerLoad } from './$types';

/** Signed-in readers of the docs get "Back to app" instead of "Sign in" in the header */
export const load: LayoutServerLoad = ({ locals, setHeaders }) => {
	const signedIn = locals.user !== null;
	// Landing, docs and legal are identical for every signed-out reader: let the browser reuse
	// them for a few minutes. `private`, not shared caches: each response carries its own CSP
	// nonce. `Vary: Cookie` refetches as soon as the reader signs in.
	if (!signedIn) setHeaders({ 'cache-control': 'private, max-age=300', vary: 'Cookie' });
	return { signedIn };
};
