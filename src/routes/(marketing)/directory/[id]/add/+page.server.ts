import { error, redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { getDirectoryEntry } from '#lib/server/connectors/index.ts';
import { ensurePersonalWorkspace } from '#lib/server/personal-workspace.ts';
import type { PageServerLoad } from './$types';

/**
 * "Add to Toolkien" from the public directory. Signed out: to sign-up (which also signs in
 * existing users) and back here. Signed in: the page confirms the workspace and runs the usual
 * add-and-connect form (a GET never adds anything, so a link cannot add servers behind the
 * user's back).
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	const entry = getDirectoryEntry(params.id);
	if (!entry) error(404, 'This server is not in the directory.', { code: 'NOT_FOUND' });
	if (!locals.user) {
		redirect(303, `${resolve('/(auth)/signup')}?redirectTo=${encodeURIComponent(url.pathname)}`);
	}
	// New accounts get it on sign-up; this keeps the add page working if that step was missed
	await ensurePersonalWorkspace(locals.user);
	return { entry };
};
