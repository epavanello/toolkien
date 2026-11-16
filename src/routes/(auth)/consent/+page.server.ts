import { redirect } from '@sveltejs/kit';
import { brand } from '#lib/brand.ts';
import {
	describeClient,
	getSwitchRequest,
	redirectOrigin,
	scopeLabels,
	verifiedQuery
} from '#lib/server/mcp/index.ts';
import { getActiveWorkspace, getById, listForUser } from '#lib/server/workspaces/index.ts';
import type { PageServerLoad } from './$types';

/**
 * Two interactions share this page (it is the OAuth `loginPage` and `consentPage`):
 * - `?<signed authorization query>`: an MCP client asks for access;
 * - `?switch=<id>`: an MCP client asks to switch workspace and the user confirms here.
 */
export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) {
		redirect(303, `/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
	}
	const userId = locals.user.id;

	const switchId = url.searchParams.get('switch');
	if (switchId) {
		const request = getSwitchRequest(switchId, userId);
		if (!request) return { mode: 'switch' as const, request: null };
		const [from, to] = await Promise.all([
			getById(userId, request.fromWorkspaceId),
			getById(userId, request.toWorkspaceId)
		]);
		return {
			mode: 'switch' as const,
			request: {
				id: request.id,
				status: request.status,
				clientName: request.clientName,
				from: from?.name ?? 'Unknown workspace',
				to: to?.name ?? 'Unknown workspace',
				expiresAt: request.expiresAt
			}
		};
	}

	const oauthQuery = url.search.slice(1);
	const query = await verifiedQuery(oauthQuery);
	const client = await describeClient(query.get('client_id') ?? '', userId);
	const workspaces = await listForUser(userId);
	const current = await getActiveWorkspace(userId, client.clientId);
	// The current choice first: a native select starts on its first option
	const ordered = [current, ...workspaces.filter((workspace) => workspace.id !== current.id)];
	return {
		mode: 'oauth' as const,
		oauthQuery,
		client,
		returnsTo: redirectOrigin(query),
		access: [
			`Use your ${brand.name} tools in the workspace you choose`,
			...scopeLabels(query.get('scope'))
		],
		workspaces: ordered.map((workspace) => ({
			value: workspace.id,
			label: workspace.kind === 'personal' ? `${workspace.name} (personal)` : workspace.name
		}))
	};
};
