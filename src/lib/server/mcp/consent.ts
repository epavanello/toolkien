/**
 * The OAuth consent screen for MCP clients (`/consent`), server side.
 *
 * Better Auth sends the browser to `/consent?<signed authorization query>` both when the user
 * must sign in (`loginPage`) and when consent is needed (`consentPage`). The page shows who is
 * asking (client name; CIMD clients are identified by their verified domain, DCR names are
 * self-asserted and marked unverified), the access requested and the workspace the client
 * starts in, and asks the user to name the client. "Allow" creates a new MCP connection (its own
 * name and workspace) and the provider issues the code inside `withConnectionGrant`, so the
 * whole grant carries that connection: approving the same client again (another Claude account,
 * another machine) makes another connection and never touches the first.
 */
import { isCimdClientIdUrlCandidate } from '@better-auth/cimd';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { auth } from '#lib/server/auth.ts';
import {
	createConnection,
	discardConnection,
	withConnectionGrant
} from '#lib/server/clients/index.ts';
import { db } from '#lib/server/db/index.ts';
import { oauthClient } from '#lib/server/db/schema/index.ts';
import { services } from './services.ts';
import { recordConsentWorkspace } from './workspace-switch.ts';

export type ConsentClient = {
	clientId: string;
	/** The registered name (self-asserted unless `verifiedDomain`) */
	name: string;
	/** Host of the CIMD `client_id` URL: the client proved it controls it */
	verifiedDomain: string | null;
	/** Self-asserted (dynamic registration): the name may be anything */
	unverified: boolean;
	homepage: string | null;
};

const SCOPE_LABELS: Record<string, string> = {
	openid: 'Know who you are',
	profile: 'See your name',
	email: 'See your email address',
	offline_access: 'Stay connected until you revoke access'
};

export const scopeLabels = (scope: string | null) =>
	(scope ?? '')
		.split(' ')
		.filter(Boolean)
		.map((item) => SCOPE_LABELS[item] ?? item);

/** The signed authorization query, verified; 400 when tampered with or expired */
export async function verifiedQuery(query: string): Promise<URLSearchParams> {
	const { secret } = await auth.$context;
	if (!query || !(await verifyOAuthQueryParams(query, secret))) {
		error(400, 'This authorization request is invalid or expired. Start again from your client.', {
			code: 'INVALID_INPUT'
		});
	}
	return new URLSearchParams(query);
}

export async function describeClient(clientId: string): Promise<ConsentClient> {
	const [row] = await db
		.select({
			name: oauthClient.name,
			uri: oauthClient.uri,
			discovery: oauthClient.clientDiscoveryId
		})
		.from(oauthClient)
		.where(eq(oauthClient.clientId, clientId))
		.limit(1);
	if (!row) error(404, 'Unknown client.', { code: 'NOT_FOUND' });
	const cimd = isCimdClientIdUrlCandidate(clientId) && row.discovery !== null;
	return {
		clientId,
		name: row.name?.trim() || 'Unnamed MCP client',
		verifiedDomain: cimd ? new URL(clientId).host : null,
		unverified: !cimd,
		homepage: row.uri ?? null
	};
}

/** Where the browser goes after the decision (shown so the user can spot a wrong app) */
export function redirectOrigin(query: URLSearchParams): string | null {
	try {
		return new URL(query.get('redirect_uri') ?? '').origin;
	} catch {
		return null;
	}
}

type ConsentResult = { url: string };

/** Accepts (or denies) the request through Better Auth; returns where to send the browser */
async function decide(request: Request, oauthQuery: string, accept: boolean): Promise<string> {
	const result = (await auth.api.oauth2Consent({
		body: { accept, oauth_query: oauthQuery },
		headers: request.headers
	})) as ConsentResult;
	return result.url;
}

export async function allowClient(input: {
	request: Request;
	userId: string;
	oauthQuery: string;
	workspaceId: string;
	/** The user's name for the client; empty keeps the registered name */
	label?: string | null;
}): Promise<ConsentResult> {
	const query = await verifiedQuery(input.oauthQuery);
	const clientId = query.get('client_id');
	if (!clientId) error(400, 'The request has no client.', { code: 'INVALID_INPUT' });
	const workspace = await services.workspaces.getById(input.userId, input.workspaceId);
	if (!workspace) error(404, 'Workspace not found.', { code: 'NOT_FOUND' });
	await describeClient(clientId);
	// Created before the code is issued, so the client's first request already finds its name
	// and workspace
	const { connectionId, name } = await createConnection({
		userId: input.userId,
		clientId,
		label: input.label ?? null,
		workspaceId: workspace.id
	});
	let url: string;
	try {
		url = await withConnectionGrant(connectionId, () =>
			decide(input.request, input.oauthQuery, true)
		);
	} catch (cause) {
		await discardConnection(connectionId);
		throw cause;
	}
	await recordConsentWorkspace(services, {
		userId: input.userId,
		clientId,
		connectionId,
		clientName: name,
		workspaceId: workspace.id
	});
	return { url };
}

export async function denyClient(input: {
	request: Request;
	oauthQuery: string;
}): Promise<ConsentResult> {
	await verifiedQuery(input.oauthQuery);
	return { url: await decide(input.request, input.oauthQuery, false) };
}
