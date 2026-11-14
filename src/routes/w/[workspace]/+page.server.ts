import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { needsGuide } from '#lib/server/clients/index.ts';
import { requireWorkspace } from '#lib/server/guards.ts';
import type { PageServerLoad } from './$types';

/**
 * Workspace landing (also where sign-in ends up): the connect guide while the user has neither a
 * connector nor an authorized MCP client, the connectors list afterwards.
 */
export const load: PageServerLoad = async ({ params }) => {
	const { workspace, actor } = await requireWorkspace(params.workspace);
	const slug = { workspace: workspace.slug };
	if (await needsGuide(actor)) redirect(307, resolve('/w/[workspace]/connect', slug));
	redirect(307, resolve('/w/[workspace]/connectors', slug));
};
