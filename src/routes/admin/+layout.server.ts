import { error, redirect } from '@sveltejs/kit';
import { isPlatformAdminEmail } from '#lib/server/limits/index.ts';
import type { LayoutServerLoad } from './$types';

/** Platform admin panel: `PLATFORM_ADMIN_EMAILS` only; 404 for everyone else */
export const load: LayoutServerLoad = ({ locals, url }) => {
	if (!locals.user) redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname)}`);
	if (!isPlatformAdminEmail(locals.user.email)) error(404, 'Not found.', { code: 'NOT_FOUND' });
};
