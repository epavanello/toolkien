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
		/**
		 * OAuth 2.1 authorization server for MCP clients (see docs/notes/mcp.md).
		 * - Issuer `${ORIGIN}/api/auth`; RFC 8414 metadata path-inserted and at the root, RFC 9728
		 *   protected-resource metadata for `/mcp` (routes in `src/routes/.well-known/**`).
		 * - PKCE: only S256 exists and it is required for every client (public clients always,
		 *   confidential ones through `clientRegistrationRequirePKCE`; CIMD cannot opt out).
		 * - Resource indicator (RFC 8707): tokens carry `aud = MCP_RESOURCE` only when the client
		 *   sends `resource`; `/mcp` verifies that audience, so a token without it is useless.
		 * - Authorization responses carry `iss` (RFC 9207, always on in the provider).
		 * - Refresh tokens rotate; reusing a rotated one after the 30 s retry window revokes the
		 *   whole token family (reuse detection).
		 */
		mcp({
			// The consent page is the single interaction entry: it sends signed-out users to
			// `/login?redirectTo=…` and back, keeping the signed authorization query intact
			loginPage: '/consent',
			consentPage: '/consent',
			resource: MCP_RESOURCE,
			resources: [
				{
					identifier: MCP_RESOURCE,
					name: brand.name,
					accessTokenTtl: ACCESS_TOKEN_TTL_SECONDS,
					refreshTokenTtl: REFRESH_TOKEN_TTL_SECONDS
				}
			],
			// The config is the source of truth for the single MCP resource
			resourceSeedMode: 'overwrite',
			enforcePerClientResources: true,
			scopes: ['openid', 'profile', 'email', 'offline_access'],
			// Every token acts for a signed-in user: no client_credentials (no user, no workspace)
			grantTypes: ['authorization_code', 'refresh_token'],
			accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
			refreshTokenExpiresIn: REFRESH_TOKEN_TTL_SECONDS,
			// Identical retries within 30 s get the same response; any other reuse kills the family
			refreshTokenReuseInterval: 30,
			codeExpiresIn: 5 * 60,
			// DCR is deprecated in MCP 2026-07-28 (CIMD preferred) but most clients still use it
			allowDynamicClientRegistration: true,
			allowUnauthenticatedClientRegistration: true,
			clientRegistrationRequirePKCE: true,
			// Native clients (Cursor, older Claude Code) omit application_type with loopback URIs
			clientRegistrationDefaultApplicationType: 'infer'
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
