import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	redirect(307, resolve('/w/[workspace]/connectors', { workspace: params.workspace }));
};
