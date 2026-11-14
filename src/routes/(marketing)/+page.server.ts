import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { directoryShowcase } from '#lib/server/connectors/index.ts';
import { ensurePersonalWorkspace } from '#lib/server/personal-workspace.ts';
import type { PageServerLoad } from './$types';

/** Keep this redirect (org-ops owns the landing): signed-in users go to their workspace */
export const load: PageServerLoad = async ({ locals }) => {
	if (locals.user) {
		const workspace = await ensurePersonalWorkspace(locals.user);
		redirect(303, resolve('/w/[workspace]', { workspace }));
	}
	return { directory: directoryShowcase() };
};
