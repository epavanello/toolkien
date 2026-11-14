import { createHash, randomBytes } from 'node:crypto';
import { error } from '@sveltejs/kit';
import { and, eq, lt } from 'drizzle-orm';
import {
	checkResourceAllowed,
	discoverOAuthServerInfo,
	exchangeAuthorization,
	extractWWWAuthenticateParams,
	refreshAuthorization,
	registerClient,
	startAuthorization,
	type AuthorizationServerMetadata,
	type FetchLike,
	type OAuthClientInformationMixed,
	type OAuthTokens
} from '@modelcontextprotocol/client';
import { ORIGIN } from '$app/env/private';
import { safeRedirectPath } from '#lib/core/redirects.ts';
import { decryptForWorkspace, encryptForWorkspace } from '#lib/server/crypto/index.ts';
import { db } from '#lib/server/db/index.ts';
import { upstreamOAuthClient, upstreamOAuthFlow } from '#lib/server/db/schema/index.ts';
import { safeFetch } from '#lib/server/net/index.ts';
import type { ConnectorRow } from './access.ts';
import { fromSealedColumns, type OAuthSecret } from './credentials.ts';
import type { DirectoryEntry } from './types.ts';

/**
 * Upstream OAuth 2.1 (Toolkien as a client of the upstream MCP server's authorization server):
 * RFC 9728 protected resource metadata → RFC 8414 AS metadata → client registration (CIMD when
 * supported and our origin is https, else DCR) → authorization code + PKCE S256 with the RFC
 * 8707 resource indicator → token exchange (RFC 9207 `iss` checked) → refresh → RFC 7009
 * revocation. All HTTP goes through `net.safeFetch`.
 */

export const FLOW_TTL_MS = 10 * 60 * 1000;
/** Refresh access tokens this long before they expire */
export const REFRESH_SKEW_MS = 60 * 1000;

export const callbackUrl = () => `${ORIGIN}/connectors/oauth/callback`;
export const clientMetadataUrl = () => `${ORIGIN}/connectors/oauth/client-metadata.json`;

/** The Client ID Metadata Document served at `clientMetadataUrl()` */
export const clientMetadataDocument = () => ({
	client_id: clientMetadataUrl(),
	client_name: 'Toolkien',
	client_uri: ORIGIN,
	redirect_uris: [callbackUrl()],
	grant_types: ['authorization_code', 'refresh_token'],
	response_types: ['code'],
	token_endpoint_auth_method: 'none'
});

const oauthFetch: FetchLike = (url, init) =>
	safeFetch(String(url instanceof URL ? url.href : url), {
		...init,
		timeoutMs: 15_000,
		maxRedirects: 2,
		maxResponseBytes: 1024 * 1024
	});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

type ClientRow = typeof upstreamOAuthClient.$inferSelect;

function failure(message: string): never {
	error(424, message, { code: 'GENERIC' });
}

async function clientInformation(row: ClientRow): Promise<OAuthClientInformationMixed> {
	const sealed = fromSealedColumns(
		row.clientSecretCiphertext,
		row.clientSecretNonce,
		row.clientSecretKeyVersion
	);
	const secret = sealed
		? new TextDecoder().decode(await decryptForWorkspace(row.workspaceId, sealed))
		: undefined;
	return { client_id: row.clientId, ...(secret ? { client_secret: secret } : {}) };
}

/** Scope from an unauthenticated probe's `WWW-Authenticate` challenge (best effort) */
async function challengeScope(url: string): Promise<string | undefined> {
	try {
		const response = await safeFetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				accept: 'application/json, text/event-stream'
			},
			body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'ping' }),
			timeoutMs: 10_000
		});
		await response.body?.cancel().catch(() => undefined);
		return response.status === 401 ? extractWWWAuthenticateParams(response).scope : undefined;
	} catch {
		return undefined;
	}
}

/** Whether the server publishes protected resource metadata (used to guess the auth type) */
export async function supportsOAuth(url: string): Promise<boolean> {
	try {
		const info = await discoverOAuthServerInfo(url, { fetchFn: oauthFetch });
		return !!info.resourceMetadata && !!info.authorizationServerMetadata;
	} catch {
		return false;
	}
}

async function ensureClient(
	conn: ConnectorRow,
	issuer: string,
	metadata: AuthorizationServerMetadata,
	scope: string | undefined
): Promise<ClientRow> {
	const [existing] = await db
		.select()
		.from(upstreamOAuthClient)
		.where(eq(upstreamOAuthClient.connectorId, conn.id))
		.limit(1);
	if (existing && existing.issuer === issuer) return existing;
	if (existing) await db.delete(upstreamOAuthClient).where(eq(upstreamOAuthClient.id, existing.id));

	const extra = metadata as AuthorizationServerMetadata & Record<string, unknown>;
	let clientId: string;
	let secret: string | undefined;
	let registration: Record<string, unknown>;
	if (extra.client_id_metadata_document_supported === true && ORIGIN.startsWith('https://')) {
		clientId = clientMetadataUrl();
		registration = { method: 'cimd', redirect_uris: [callbackUrl()] };
	} else if (metadata.registration_endpoint) {
		try {
			const full = await registerClient(issuer, {
				metadata,
				clientMetadata: {
					client_name: 'Toolkien',
					client_uri: ORIGIN,
					redirect_uris: [callbackUrl()],
					grant_types: ['authorization_code', 'refresh_token'],
					response_types: ['code'],
					token_endpoint_auth_method: 'none'
				},
				scope,
				fetchFn: oauthFetch
			});
			clientId = full.client_id;
			secret = full.client_secret;
			registration = {
				method: 'dcr',
				redirect_uris: full.redirect_uris,
				token_endpoint_auth_method: full.token_endpoint_auth_method ?? 'none',
				scope: full.scope ?? null
			};
		} catch {
			failure('The authorization server refused to register Toolkien as a client.');
		}
	} else {
		failure(
			'This server needs a pre-registered OAuth client, which Toolkien cannot create. Paste a token instead if the server accepts one.'
		);
	}

	const sealed = secret ? await encryptForWorkspace(conn.workspaceId, secret) : null;
	const [row] = await db
		.insert(upstreamOAuthClient)
		.values({
			connectorId: conn.id,
			workspaceId: conn.workspaceId,
			issuer,
			clientId,
			clientSecretCiphertext: sealed ? Buffer.from(sealed.ciphertext) : null,
			clientSecretNonce: sealed ? Buffer.from(sealed.nonce) : null,
			clientSecretKeyVersion: sealed?.keyVersion ?? null,
			serverMetadata: metadata as unknown as Record<string, unknown>,
			registration
		})
		.returning();
	return row;
}

export async function startUpstreamOAuth(input: {
	conn: ConnectorRow;
	entry: DirectoryEntry | null;
	userId: string;
	credentialUserId: string | null;
	returnTo: string;
}): Promise<{ authorizationUrl: string }> {
	const { conn } = input;
	let info: Awaited<ReturnType<typeof discoverOAuthServerInfo>>;
	try {
		info = await discoverOAuthServerInfo(conn.url, { fetchFn: oauthFetch });
	} catch {
		failure('Could not discover the authorization server of this MCP server.');
	}
	const metadata = info.authorizationServerMetadata;
	if (!metadata) failure('The MCP server does not publish OAuth metadata.');
	if (!metadata.code_challenge_methods_supported?.includes('S256')) {
		failure('The authorization server does not support PKCE (S256).');
	}
	const resource = info.resourceMetadata?.resource ?? conn.url;
	if (!checkResourceAllowed({ requestedResource: conn.url, configuredResource: resource })) {
		failure('The protected resource metadata does not match the server URL.');
	}

	const scope =
		input.entry?.scopes?.join(' ') ||
		(await challengeScope(conn.url)) ||
		info.resourceMetadata?.scopes_supported?.join(' ') ||
		undefined;
	const client = await ensureClient(conn, metadata.issuer, metadata, scope);
	const state = randomBytes(32).toString('base64url');
	const { authorizationUrl, codeVerifier } = await startAuthorization(metadata.issuer, {
		metadata,
		clientInformation: await clientInformation(client),
		redirectUrl: callbackUrl(),
		scope,
		state,
		resource
	});
	const sealed = await encryptForWorkspace(conn.workspaceId, codeVerifier);
	await db.delete(upstreamOAuthFlow).where(lt(upstreamOAuthFlow.expiresAt, new Date()));
	await db.insert(upstreamOAuthFlow).values({
		stateHash: sha256(state),
		connectorId: conn.id,
		workspaceId: conn.workspaceId,
		userId: input.userId,
		credentialUserId: input.credentialUserId,
		codeVerifierCiphertext: Buffer.from(sealed.ciphertext),
		codeVerifierNonce: Buffer.from(sealed.nonce),
		codeVerifierKeyVersion: sealed.keyVersion,
		redirectUri: callbackUrl(),
		resource,
		scope: scope ?? null,
		returnTo: safeRedirectPath(input.returnTo),
		expiresAt: new Date(Date.now() + FLOW_TTL_MS)
	});
	return { authorizationUrl: authorizationUrl.href };
}

export type CompletedFlow = {
	connectorId: string;
	workspaceId: string;
	userId: string;
	credentialUserId: string | null;
	returnTo: string;
	secret: OAuthSecret;
	scope: string | null;
	expiresAt: Date | null;
};

const expiry = (tokens: OAuthTokens) =>
	typeof tokens.expires_in === 'number' ? new Date(Date.now() + tokens.expires_in * 1000) : null;

const toSecret = (tokens: OAuthTokens, previousRefresh?: string): OAuthSecret => ({
	accessToken: tokens.access_token,
	...(tokens.refresh_token || previousRefresh
		? { refreshToken: tokens.refresh_token ?? previousRefresh }
		: {}),
	tokenType: tokens.token_type
});

/** Redeems the authorization code of a flow (single use); does not store the tokens */
export async function completeUpstreamOAuth(
	state: string,
	code: string,
	opts: { userId?: string; iss?: string }
): Promise<CompletedFlow> {
	const [flow] = await db
		.delete(upstreamOAuthFlow)
		.where(eq(upstreamOAuthFlow.stateHash, sha256(state)))
		.returning();
	if (!flow || flow.expiresAt.getTime() < Date.now()) {
		error(400, 'This authorization link expired. Start again from the connector.', {
			code: 'INVALID_INPUT'
		});
	}
	if (opts.userId !== undefined && opts.userId !== flow.userId) {
		error(403, 'This authorization was started by another account.', { code: 'FORBIDDEN' });
	}
	const [client] = await db
		.select()
		.from(upstreamOAuthClient)
		.where(and(eq(upstreamOAuthClient.connectorId, flow.connectorId)))
		.limit(1);
	const sealed = fromSealedColumns(
		flow.codeVerifierCiphertext,
		flow.codeVerifierNonce,
		flow.codeVerifierKeyVersion
	);
	if (!client || !sealed) failure('The connector changed during authorization. Start again.');
	const codeVerifier = new TextDecoder().decode(
		await decryptForWorkspace(flow.workspaceId, sealed)
	);
	const metadata = client.serverMetadata as unknown as AuthorizationServerMetadata;
	let tokens: OAuthTokens;
	try {
		tokens = await exchangeAuthorization(client.issuer, {
			metadata,
			clientInformation: await clientInformation(client),
			authorizationCode: code,
			iss: opts.iss,
			codeVerifier,
			redirectUri: flow.redirectUri,
			resource: flow.resource ?? undefined,
			fetchFn: oauthFetch
		});
	} catch {
		failure('The authorization server refused the authorization code.');
	}
	return {
		connectorId: flow.connectorId,
		workspaceId: flow.workspaceId,
		userId: flow.userId,
		credentialUserId: flow.credentialUserId,
		returnTo: flow.returnTo,
		secret: toSecret(tokens),
		scope: tokens.scope ?? flow.scope,
		expiresAt: expiry(tokens)
	};
}

async function clientFor(connectorId: string) {
	const [client] = await db
		.select()
		.from(upstreamOAuthClient)
		.where(eq(upstreamOAuthClient.connectorId, connectorId))
		.limit(1);
	return client ?? null;
}

/** Refresh grant; `null` when the grant is gone (the user must reconnect) */
export async function refreshUpstreamTokens(
	conn: ConnectorRow,
	secret: OAuthSecret
): Promise<{ secret: OAuthSecret; scope: string | null; expiresAt: Date | null } | null> {
	if (!secret.refreshToken) return null;
	const client = await clientFor(conn.id);
	if (!client) return null;
	try {
		const tokens = await refreshAuthorization(client.issuer, {
			metadata: client.serverMetadata as unknown as AuthorizationServerMetadata,
			clientInformation: await clientInformation(client),
			refreshToken: secret.refreshToken,
			resource: conn.url,
			fetchFn: oauthFetch
		});
		return {
			secret: toSecret(tokens, secret.refreshToken),
			scope: tokens.scope ?? null,
			expiresAt: expiry(tokens)
		};
	} catch {
		return null;
	}
}

/** RFC 7009 revocation of the refresh and access tokens; best effort, never throws */
export async function revokeUpstreamTokens(conn: ConnectorRow, secret: OAuthSecret): Promise<void> {
	try {
		const client = await clientFor(conn.id);
		const endpoint = (client?.serverMetadata as Record<string, unknown> | undefined)
			?.revocation_endpoint;
		if (!client || typeof endpoint !== 'string') return;
		const info = await clientInformation(client);
		const tokens: [string, string][] = [];
		if (secret.refreshToken) tokens.push([secret.refreshToken, 'refresh_token']);
		tokens.push([secret.accessToken, 'access_token']);
		for (const [token, hint] of tokens) {
			const body = new URLSearchParams({ token, token_type_hint: hint, client_id: info.client_id });
			if ('client_secret' in info && info.client_secret)
				body.set('client_secret', info.client_secret);
			const response = await safeFetch(endpoint, {
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body,
				timeoutMs: 10_000
			});
			await response.body?.cancel().catch(() => undefined);
		}
	} catch {
		// Revocation is best effort: the credential is deleted locally either way
	}
}

/** Job: deletes expired authorization flows */
export async function purgeExpiredFlows(now = new Date()) {
	await db.delete(upstreamOAuthFlow).where(lt(upstreamOAuthFlow.expiresAt, now));
}

/** The user denied (or the AS failed) the authorization: drops the flow, returns where to go */
export async function abandonUpstreamOAuth(state: string, userId: string): Promise<string | null> {
	const [flow] = await db
		.delete(upstreamOAuthFlow)
		.where(
			and(eq(upstreamOAuthFlow.stateHash, sha256(state)), eq(upstreamOAuthFlow.userId, userId))
		)
		.returning();
	return flow ? flow.returnTo : null;
}
