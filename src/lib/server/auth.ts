import { building, dev } from '$app/env';
import { BETTER_AUTH_SECRET, ORIGIN } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { cimd } from '@better-auth/cimd';
import { mcp } from '@better-auth/mcp';
import { passkey } from '@better-auth/passkey';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { betterAuth } from 'better-auth/minimal';
import { emailOTP, jwt, magicLink, organization } from 'better-auth/plugins';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { brand } from '#lib/brand.ts';
import { safeRedirectPath } from '#lib/core/redirects.ts';
import { db } from '#lib/server/db/index.ts';
import { loginEmail, sendEmail } from '#lib/server/email/index.ts';
import { safeFetch } from '#lib/server/net/index.ts';
import { ensurePersonalWorkspace } from '#lib/server/personal-workspace.ts';

if (!building && !dev && !BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set');

/** The MCP protected resource: access tokens are audience-bound to it (RFC 8707) */
export const MCP_RESOURCE = `${ORIGIN}/mcp`;

/** Sign-in by email: one message carries a magic link and a 6-digit code, both single use */
export const EMAIL_SIGN_IN_TTL_SECONDS = 10 * 60;

/**
 * HTTP endpoints of the email plugins we never expose: sign-in emails are requested and
 * verified only through our remote functions (`#lib/server/email-sign-in.ts`), which rate-limit
 * sends and keep the magic link behind a confirm button (link scanners prefetch GET links).
 */
const SERVER_ONLY_PATHS = [
	'/sign-in/magic-link',
	'/magic-link/verify',
	'/sign-in/email-otp',
	'/email-otp/send-verification-otp',
	'/email-otp/check-verification-otp',
	'/email-otp/verify-email',
	'/email-otp/request-password-reset',
	'/forget-password/email-otp',
	'/email-otp/reset-password',
	'/email-otp/request-email-change',
	'/email-otp/change-email'
];

/** MCP access tokens are short-lived; refresh tokens rotate with reuse detection */
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const auth = betterAuth({
	appName: brand.name,
	baseURL: ORIGIN,
	// The runtime secret is not available while the build analyses server modules
	secret: building ? crypto.randomUUID() + crypto.randomUUID() : BETTER_AUTH_SECRET,
	trustedOrigins: [ORIGIN],
	disabledPaths: SERVER_ONLY_PATHS,
	// Behind the reverse proxy (Traefik, nginx) the socket address is the proxy's: rate limits
	// would put every client in one bucket. `X-Real-IP` is overwritten by the proxy with the
	// connecting client, unlike the client-controlled left side of `X-Forwarded-For`.
	advanced: { ipAddress: { ipAddressHeaders: ['x-real-ip'] } },
	database: drizzleAdapter(db, { provider: 'sqlite' }),
	user: {
		additionalFields: {
			/** Kill switch at user level: set by a platform admin, blocks sign-in and MCP access */
			suspendedAt: { type: 'date', required: false, input: false }
		},
		deleteUser: { enabled: true }
	},
	// Passwordless: email (magic link + code) and passkeys. No passwords to leak or reset.
	emailAndPassword: { enabled: false },
	databaseHooks: {
		user: {
			create: {
				// Email sign-up asks for the address only: start with its local part as the name
				before: async (user) => ({
					data: { ...user, name: user.name?.trim() || user.email.split('@')[0]!.slice(0, 100) }
				}),
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
		/**
		 * Email sign-in (also signs up). `email-sign-in.ts` first creates the code (server-only
		 * `createVerificationOTP`), then asks for the magic link with the code in `metadata`, so
		 * one email carries both. Tokens and codes are stored hashed.
		 */
		magicLink({
			expiresIn: EMAIL_SIGN_IN_TTL_SECONDS,
			storeToken: 'hashed',
			sendMagicLink: async ({ email, token, metadata }) => {
				const code = String(metadata?.code ?? '');
				if (!/^\d{6}$/.test(code)) throw new Error('Sign-in code missing');
				// The link opens a confirm page; only its button consumes the token
				const url = new URL('/login/confirm', ORIGIN);
				url.searchParams.set('token', token);
				const redirectTo = safeRedirectPath(String(metadata?.redirectTo ?? '/'));
				if (redirectTo !== '/') url.searchParams.set('redirectTo', redirectTo);
				await sendEmail(
					loginEmail({
						to: email,
						product: brand.name,
						url: url.toString(),
						code,
						expiresMinutes: EMAIL_SIGN_IN_TTL_SECONDS / 60
					})
				);
			}
		}),
		emailOTP({
			otpLength: 6,
			expiresIn: EMAIL_SIGN_IN_TTL_SECONDS,
			storeOTP: 'hashed',
			allowedAttempts: 5,
			// Never called: the send endpoint is disabled and codes go out with the magic link
			sendVerificationOTP: async () => {
				throw new Error('Codes are sent with the magic link');
			}
		}),
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
