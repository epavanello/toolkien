/**
 * MCP server public API (owner: mcp). See `types.ts` for the contract and `docs/notes/mcp.md`
 * for the decisions (versions, elicitation, OAuth).
 */
import { createHash, randomBytes } from 'node:crypto';
import { requireMcpAuth } from '@better-auth/mcp';
import { dev } from '$app/env';
import { BETTER_AUTH_SECRET, ORIGIN } from '$app/env/private';
import { eq } from 'drizzle-orm';
import { auth, MCP_RESOURCE } from '#lib/server/auth.ts';
import { hasLiveGrant } from '#lib/server/clients/index.ts';
import { db } from '#lib/server/db/index.ts';
import { oauthClient, user } from '#lib/server/db/schema/index.ts';
import * as limits from '#lib/server/limits/index.ts';
import { createMcpEndpoint, originPolicy } from './endpoint.ts';
import { createHandleMcpRequest } from './handler.ts';
import { services } from './services.ts';
import type { HandleMcpRequest } from './types.ts';
import { decideSwitchRequest } from './workspace-switch.ts';

export * from './types.ts';
export { methodNotAllowed } from './endpoint.ts';
export { getSwitchRequest } from './switch-requests.ts';
export {
	allowClient,
	denyClient,
	describeClient,
	redirectOrigin,
	scopeLabels,
	verifiedQuery,
	type ConsentClient
} from './consent.ts';

/** HMAC key for multi-round-trip `requestState`, derived from the auth secret */
const stateKey: Uint8Array = BETTER_AUTH_SECRET
	? createHash('sha256').update(`toolkien:mcp:request-state\0${BETTER_AUTH_SECRET}`).digest()
	: randomBytes(32);

export const handleMcpRequest: HandleMcpRequest = createHandleMcpRequest({
	deps: services,
	stateKey,
	// Rejected requests and transport errors: the error name only, never payloads
	onerror: (error) => console.error(`[mcp] ${error.name}${dev ? `: ${error.message}` : ''}`)
});

/** Client names change rarely; a short cache keeps the per-request cost to one lookup a minute */
const clientCache = new Map<
	string,
	{ at: number; value: { name: string | null; disabled: boolean } | null }
>();
const CLIENT_CACHE_MS = 60_000;

async function loadClient(clientId: string) {
	const cached = clientCache.get(clientId);
	if (cached && Date.now() - cached.at < CLIENT_CACHE_MS) return cached.value;
	const [row] = await db
		.select({ name: oauthClient.name, disabled: oauthClient.disabled })
		.from(oauthClient)
		.where(eq(oauthClient.clientId, clientId))
		.limit(1);
	const value = row ? { name: row.name, disabled: !!row.disabled } : null;
	clientCache.set(clientId, { at: Date.now(), value });
	return value;
}

async function loadUser(userId: string) {
	const [row] = await db
		.select({ suspendedAt: user.suspendedAt })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	return row ? { suspended: row.suspendedAt !== null } : null;
}

/** `/mcp` (POST): origin, rate limits, bearer token, kill switches, then the MCP handler */
export const mcpEndpoint = createMcpEndpoint({
	handle: handleMcpRequest,
	verify: (request, next) =>
		requireMcpAuth(auth, (verified, claims) => next(verified, claims), {
			resource: MCP_RESOURCE
		})(request),
	loadClient,
	loadUser,
	hasLiveGrant: (userId, clientId) => hasLiveGrant(userId, clientId),
	resourceMetadataUrl: `${ORIGIN}/.well-known/oauth-protected-resource/mcp`,
	limits,
	isAllowedOrigin: originPolicy(ORIGIN, dev)
});

/** The human answered a workspace switch on the confirmation page */
export const decideWorkspaceSwitch = (input: {
	requestId: string;
	userId: string;
	confirm: boolean;
}) => decideSwitchRequest(services, input);
