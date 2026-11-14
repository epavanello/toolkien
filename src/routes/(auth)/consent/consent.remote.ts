import { command, form, getRequestEvent } from '$app/server';
import { z } from 'zod';
import { requireUser } from '#lib/server/guards.ts';
import { allowClient, decideWorkspaceSwitch, denyClient } from '#lib/server/mcp/index.ts';
import { error } from '@sveltejs/kit';

/** "Allow": issues the authorization code; the page then sends the browser to `url` */
export const authorizeClient = form(
	z.object({
		oauthQuery: z.string().min(1),
		workspaceId: z.string().min(1, { error: 'Choose a workspace.' })
	}),
	async ({ oauthQuery, workspaceId }) => {
		const user = requireUser();
		const { request } = getRequestEvent();
		return allowClient({ request, userId: user.id, oauthQuery, workspaceId });
	}
);

/** "Deny": the client gets `access_denied` */
export const rejectClient = command(z.string().min(1), async (oauthQuery) => {
	requireUser();
	const { request } = getRequestEvent();
	return denyClient({ request, oauthQuery });
});

/** The human confirms or refuses a workspace switch asked by an MCP client */
export const decideSwitch = command(
	z.object({ requestId: z.string().min(1), confirm: z.boolean() }),
	async ({ requestId, confirm }) => {
		const user = requireUser();
		const settled = await decideWorkspaceSwitch({ requestId, userId: user.id, confirm });
		if (!settled)
			error(404, 'This request expired or was already answered.', { code: 'NOT_FOUND' });
	}
);
