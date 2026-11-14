import { redirect } from '@sveltejs/kit';
import { requireWorkspace } from '#lib/server/guards.ts';
import { listForUser } from '#lib/server/workspaces/index.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	}
	const { workspace } = await requireWorkspace(params.workspace);
	const { id, name, email, image } = locals.user;
	return {
		workspace,
		workspaces: await listForUser(id),
		user: { id, name, email, image: image ?? null }
	};
};
