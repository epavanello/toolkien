import { building, dev } from '$app/env';
import { BETTER_AUTH_SECRET, ORIGIN } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { cimd } from '@better-auth/cimd';
import { mcp } from '@better-auth/mcp';
import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';
import { jwt, organization, twoFactor } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { brand } from '#lib/brand.ts';
import { db } from '#lib/server/db/index.ts';
import { safeFetch } from '#lib/server/net/index.ts';
import { ensurePersonalWorkspace } from '#lib/server/personal-workspace.ts';

if (!building && !dev && !BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');

/** The MCP protected resource: access tokens are audience-bound to it (RFC 8707) */
export const MCP_RESOURCE = `${ORIGIN}/mcp`;

/** MCP access tokens are short-lived; refresh tokens rotate with reuse detection */
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const auth = betterAuth({
	appName: brand.name,
	baseURL: ORIGIN,
	// The runtime secret is not available while the build analyses server modules
	secret: building ? crypto.randomUUID() + crypto.randomUUID() : BETTER_AUTH_SECRET,
	trustedOrigins: [ORIGIN],
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	user: {
		additionalFields: {
			/** Kill switch at user level: set by a platform admin, blocks sign-in and MCP access */
			suspendedAt: { type: 'date', required: false, input: false }
		},
		deleteUser: { enabled: true }
	},
	// No email service: no verification or reset emails (see DECISIONS.md)
	emailAndPassword: { enabled: true, minPasswordLength: 12, autoSignIn: true },
	databaseHooks: {
		user: {
			create: {
				// Every account starts with its personal workspace
				after: async (user) => {
					await ensurePersonalWorkspace(user);
				}
			}
		}
	},
	plugins: [
		organization({
			creatorRole: 'owner',
			// Deletion goes through the 7-day grace period of the workspaces module
			disableOrganizationDeletion: true,
			// Invites are links (`workspace_invite_link`), never emails
			invitationExpiresIn: 7 * 24 * 60 * 60,
			schema: {
				organization: {
					additionalFields: {
						kind: { type: 'string', required: true, defaultValue: 'company', input: false },
						/** Owner asked for deletion; hard delete runs 7 days later unless cancelled */
						deleteScheduledAt: { type: 'date', required: false, input: false },
						/** Workspace kill switch */
						suspendedAt: { type: 'date', required: false, input: false }
					}
				}
			}
		}),
		passkey({ rpID: new URL(ORIGIN).hostname, rpName: brand.name, origin: ORIGIN }),
		twoFactor({ issuer: brand.name }),
		jwt(),
		// OAuth 2.1 authorization server for MCP clients (refined by the mcp vertical)
		mcp({
			loginPage: '/login',
			consentPage: '/consent',
			resource: MCP_RESOURCE,
			accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
			refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
			// DCR is deprecated in MCP 2026-07-28 but still used by many clients
			allowDynamicClientRegistration: true,
			allowUnauthenticatedClientRegistration: true,
			clientRegistrationRequirePKCE: true
		}),
		// Client ID Metadata Documents, fetched through the SSRF-safe transport
		cimd({
			metadataProfile: 'mcp-2026-07-28',
			fetchClientMetadataResource: (input, init) =>
				safeFetch(input instanceof Request ? input.url : input, init)
		}),
		sveltekitCookies(getRequestEvent) // must stay the last plugin
	]
});

export type AuthSession = typeof auth.$Infer.Session;
export type AuthUser = AuthSession['user'];
