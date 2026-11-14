import { exportAccount } from '#lib/server/account/index.ts';
import { requireUser } from '#lib/server/guards.ts';
import type { RequestHandler } from './$types';

/** The signed-in user's data export (JSON, metadata only) */
export const GET: RequestHandler = async () => {
	const user = requireUser();
	const data = await exportAccount(user.id);
	const day = new Date().toISOString().slice(0, 10);
	return new Response(JSON.stringify(data, null, 2), {
		headers: {
			'Content-Type': 'application/json; charset=utf-8',
			'Content-Disposition': `attachment; filename="toolkien-account-${day}.json"`,
			'Cache-Control': 'no-store'
		}
	});
};
