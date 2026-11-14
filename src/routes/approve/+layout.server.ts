import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Approval links come from agents: send signed-out humans through login and back */
export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	}
};
