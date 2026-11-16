import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from 'drizzle-orm';
import { ORIGIN } from '$app/env/private';
import { record } from '#lib/server/audit/index.ts';
import { connectorIcons } from '#lib/server/connectors/index.ts';
import { db } from '#lib/server/db/index.ts';
import {
	auditEvent,
	connector,
	mcpConnection,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken
} from '#lib/server/db/schema/index.ts';
import { listForUser, setActiveWorkspace } from '#lib/server/workspaces/index.ts';
import type { WorkspaceActor, WorkspaceSummary } from '#lib/server/workspaces/types.ts';
import {
	cleanClientLabel,
	needsConnectGuide,
	type AuthorizedClient,
	type ClientWorkspace,
	type FirstToolCall,
	type OnboardingServer,
	type OnboardingStatus,
	type RevokedClient
} from './types.ts';

export type * from './types.ts';
export { CLIENT_LABEL_MAX, cleanClientLabel, needsConnectGuide } from './types.ts';
export { CONNECTION_CLAIM, withConnectionGrant } from './connection-grant.ts';

export const mcpUrl = () => `${ORIGIN}/mcp`;

const UNNAMED = 'Unnamed MCP client';

/** Events recorded with a client id that are not the client being used */
const NOT_CLIENT_USE = ['workspace.switched', 'mcp_client.renamed', 'mcp_client.revoked'] as const;

const toClientWorkspace = ({ id, slug, name, kind }: WorkspaceSummary): ClientWorkspace => ({
	id,
	slug,
	name,
	kind
});

/** Refresh-token activity of one connection (grants carry the connection as `reference_id`) */
type Activity = { first: Date | null; last: Date | null; live: boolean; issued: number };

const toDate = (value: number | null) => (value == null ? null : new Date(Number(value)));

/** Per connection of the user: first and last refresh token, and whether one is still usable */
async function tokenActivity(
	userId: string,
	now: number,
	connectionIds?: string[]
): Promise<Map<string, Activity>> {
	const rows = await db
		.select({
			connectionId: oauthRefreshToken.referenceId,
			first: sql<number | null>`min(${oauthRefreshToken.createdAt})`,
			last: sql<number | null>`max(${oauthRefreshToken.createdAt})`,
			live: sql<number>`max(case when ${oauthRefreshToken.revoked} is null and ${oauthRefreshToken.expiresAt} > ${now} then 1 else 0 end)`,
			issued: sql<number>`count(*)`
		})
		.from(oauthRefreshToken)
		.where(
			and(
				eq(oauthRefreshToken.userId, userId),
				connectionIds
					? inArray(oauthRefreshToken.referenceId, connectionIds)
					: isNotNull(oauthRefreshToken.referenceId)
			)
		)
		.groupBy(oauthRefreshToken.referenceId);
	return new Map(
		rows.flatMap((row) =>
			row.connectionId
				? [
						[
							row.connectionId,
							{
								first: toDate(row.first),
								last: toDate(row.last),
								live: Number(row.live) === 1,
								issued: Number(row.issued)
							}
						]
					]
				: []
		)
	);
}

/**
 * A connection is live while its consent stands and its grant does: a usable refresh token, or
 * none issued at all (the code not exchanged yet, or a client without `offline_access`). Once
 * every refresh token expired or was revoked (reuse detection), the client signs in again and
 * that is a new connection.
 */
const isLive = (consented: boolean, tokens: Activity | undefined) =>
	consented && (!tokens || tokens.issued === 0 || tokens.live);

/** Ids of the user's consents, i.e. of the connections they approved and did not disconnect */
async function consentedConnections(userId: string, connectionIds?: string[]) {
	const rows = await db
		.select({ connectionId: oauthConsent.referenceId })
		.from(oauthConsent)
		.where(
			and(
				eq(oauthConsent.userId, userId),
				connectionIds
					? inArray(oauthConsent.referenceId, connectionIds)
					: isNotNull(oauthConsent.referenceId)
			)
		);
	return new Set(rows.flatMap((row) => (row.connectionId ? [row.connectionId] : [])));
}

const latest = (...dates: (Date | null | undefined)[]) =>
	dates.reduce<Date | null>((max, date) => (date && (!max || date > max) ? date : max), null);

/** MCP connections the user has authorized (see the contract), most recently used first */
export async function listAuthorizedClients(
	userId: string,
	now = new Date(),
	workspaces?: WorkspaceSummary[]
): Promise<AuthorizedClient[]> {
	const [connections, consented, tokens, mine] = await Promise.all([
		db
			.select({
				id: mcpConnection.id,
				clientId: mcpConnection.clientId,
				label: mcpConnection.label,
				workspaceId: mcpConnection.workspaceId,
				createdAt: mcpConnection.createdAt,
				registeredName: oauthClient.name
			})
			.from(mcpConnection)
			.leftJoin(oauthClient, eq(oauthClient.clientId, mcpConnection.clientId))
			.where(eq(mcpConnection.userId, userId)),
		consentedConnections(userId),
		tokenActivity(userId, now.getTime()),
		workspaces ?? listForUser(userId)
	]);
	const authorized = connections.filter((row) => isLive(consented.has(row.id), tokens.get(row.id)));
	if (authorized.length === 0) return [];
	const ids = authorized.map((row) => row.id);

	const calls = await db
		.select({
			connectionId: auditEvent.connectionId,
			last: sql<number | null>`max(${auditEvent.occurredAt})`
		})
		.from(auditEvent)
		.where(
			and(
				eq(auditEvent.userId, userId),
				inArray(auditEvent.connectionId, ids),
				// Done by the user to the client (consent, settings), not by the client
				notInArray(auditEvent.type, [...NOT_CLIENT_USE])
			)
		)
		.groupBy(auditEvent.connectionId);
	const lastCall = new Map(calls.map((row) => [row.connectionId, toDate(row.last)]));
	// Same resolution as `getActiveWorkspace`: a stored workspace still visible, else personal
	const workspaceById = new Map(mine.map((workspace) => [workspace.id, workspace]));
	const personal = mine.find((workspace) => workspace.kind === 'personal');

	return authorized
		.map((row) => {
			const registeredName = row.registeredName?.trim() || null;
			const activity = tokens.get(row.id);
			const workspace = (row.workspaceId && workspaceById.get(row.workspaceId)) || personal;
			return {
				connectionId: row.id,
				clientId: row.clientId,
				name: row.label ?? registeredName ?? UNNAMED,
				registeredName,
				workspace: workspace ? toClientWorkspace(workspace) : null,
				connectedAt: row.createdAt,
				lastUsedAt: latest(activity?.last, lastCall.get(row.id))
			};
		})
		.sort(
			(a, b) =>
				(b.lastUsedAt ?? b.connectedAt).getTime() - (a.lastUsedAt ?? a.connectedAt).getTime()
		);
}

/**
 * Whether the user still grants this connection access (see `isLive`). `/mcp` checks it on
 * every request, so a disconnect also stops access tokens already issued.
 */
export async function hasLiveGrant(
	userId: string,
	connectionId: string,
	now = new Date()
): Promise<boolean> {
	const [consented, tokens] = await Promise.all([
		consentedConnections(userId, [connectionId]),
		tokenActivity(userId, now.getTime(), [connectionId])
	]);
	return isLive(consented.has(connectionId), tokens.get(connectionId));
}

/** What `/mcp` needs of a connection on every request */
export type ConnectionRecord = {
	id: string;
	userId: string;
	clientId: string;
	label: string | null;
	clientInfo: string | null;
};

/**
 * Connections by id: `/mcp` reads one on every request, so they are cached a minute; writes
 * here update the cache at once.
 */
const connectionCache = new Map<string, { at: number; value: ConnectionRecord | null }>();
const CONNECTION_CACHE_MS = 60_000;
const CONNECTION_CACHE_MAX = 5_000;
const cacheConnection = (id: string, value: ConnectionRecord | null) => {
	if (connectionCache.size >= CONNECTION_CACHE_MAX) connectionCache.clear();
	connectionCache.set(id, { at: Date.now(), value });
};
const patchCachedConnection = (id: string, patch: Partial<ConnectionRecord>) => {
	const cached = connectionCache.get(id);
	if (cached?.value) cached.value = { ...cached.value, ...patch };
};

/** The connection, `null` when it does not exist (disconnected, or never created) */
export async function loadConnection(connectionId: string): Promise<ConnectionRecord | null> {
	const cached = connectionCache.get(connectionId);
	if (cached && Date.now() - cached.at < CONNECTION_CACHE_MS) return cached.value;
	const [row] = await db
		.select({
			id: mcpConnection.id,
			userId: mcpConnection.userId,
			clientId: mcpConnection.clientId,
			label: mcpConnection.label,
			clientInfo: mcpConnection.clientInfo
		})
		.from(mcpConnection)
		.where(eq(mcpConnection.id, connectionId))
		.limit(1);
	const value = row ?? null;
	cacheConnection(connectionId, value);
	return value;
}

/**
 * Remembers the MCP `clientInfo` (`name version`) a connection sent in `initialize`, so its later
 * stateless requests are labelled with it in the activity. Display-only metadata.
 */
export async function rememberClientInfo(connectionId: string, info: string) {
	await db
		.update(mcpConnection)
		.set({ clientInfo: info, updatedAt: new Date() })
		.where(eq(mcpConnection.id, connectionId));
	patchCachedConnection(connectionId, { clientInfo: info });
}

/** The registered (OAuth) name of a client, trimmed; `null` when it has none */
async function registeredName(clientId: string): Promise<string | null> {
	const [row] = await db
		.select({ name: oauthClient.name })
		.from(oauthClient)
		.where(eq(oauthClient.clientId, clientId))
		.limit(1);
	return row?.name?.trim() || null;
}

/** The name to store: empty, or equal to the registered name, stores none */
async function labelToStore(clientId: string, input: string | null) {
	const registered = await registeredName(clientId);
	const cleaned = cleanClientLabel(input);
	const label = cleaned && cleaned !== registered ? cleaned : null;
	return { label, name: label ?? registered ?? UNNAMED };
}

/**
 * Creates the connection an "Allow" on the consent screen is about to grant, without checks or
 * audit (the caller verified the request and the workspace). Returns its id and the name it is
 * shown with.
 */
export async function createConnection(input: {
	userId: string;
	clientId: string;
	label: string | null;
	workspaceId: string;
}): Promise<{ connectionId: string; name: string }> {
	const { label, name } = await labelToStore(input.clientId, input.label);
	const connectionId = crypto.randomUUID();
	await db.insert(mcpConnection).values({
		id: connectionId,
		userId: input.userId,
		clientId: input.clientId,
		label,
		workspaceId: input.workspaceId
	});
	return { connectionId, name };
}

/** Removes a connection whose grant was never issued (the "Allow" failed) */
export async function discardConnection(connectionId: string) {
	await db.delete(mcpConnection).where(eq(mcpConnection.id, connectionId));
	connectionCache.delete(connectionId);
}

/** One of the user's authorized connections, else 404 */
async function authorizedConnection(
	userId: string,
	connectionId: string,
	workspaces?: WorkspaceSummary[]
): Promise<AuthorizedClient> {
	const clients = await listAuthorizedClients(userId, new Date(), workspaces);
	const found = clients.find((client) => client.connectionId === connectionId);
	if (!found) error(404, 'This client is not connected to your account.', { code: 'NOT_FOUND' });
	return found;
}

/**
 * Renames one of the actor's connections (see the contract), audited in the actor's workspace.
 * 404 when it is not theirs or no longer authorized.
 */
export async function setClientLabel(
	actor: WorkspaceActor,
	connectionId: string,
	input: string | null
): Promise<{ connectionId: string; name: string }> {
	const current = await authorizedConnection(actor.userId, connectionId);
	const { label, name } = await labelToStore(current.clientId, input);
	await db
		.update(mcpConnection)
		.set({ label, updatedAt: new Date() })
		.where(and(eq(mcpConnection.id, connectionId), eq(mcpConnection.userId, actor.userId)));
	patchCachedConnection(connectionId, { label });
	if (name !== current.name) {
		await record({
			type: 'mcp_client.renamed',
			outcome: 'success',
			workspaceId: actor.workspaceId,
			userId: actor.userId,
			clientId: current.clientId,
			connectionId,
			clientName: name,
			metadata: { previousName: current.name }
		});
	}
	return { connectionId, name };
}

/**
 * Moves one of the actor's connections to another of their workspaces (see the contract). 404
 * when the connection is not authorized or the workspace is not theirs; nothing recorded when
 * it is already there.
 */
export async function moveClient(
	actor: WorkspaceActor,
	connectionId: string,
	workspaceId: string
): Promise<{ connectionId: string; name: string; workspace: ClientWorkspace }> {
	const workspaces = await listForUser(actor.userId);
	const target = workspaces.find((workspace) => workspace.id === workspaceId);
	if (!target) error(404, 'Workspace not found.', { code: 'NOT_FOUND' });
	const client = await authorizedConnection(actor.userId, connectionId, workspaces);
	const workspace = toClientWorkspace(target);
	if (client.workspace?.id === target.id) return { connectionId, name: client.name, workspace };
	await setActiveWorkspace(actor.userId, connectionId, target.id);
	await record({
		type: 'workspace.switched',
		outcome: 'success',
		workspaceId: target.id,
		userId: actor.userId,
		clientId: client.clientId,
		connectionId,
		clientName: client.name,
		approvedBy: 'self',
		approverUserId: actor.userId,
		metadata: { fromWorkspaceId: client.workspace?.id ?? null, channel: 'settings' }
	});
	return { connectionId, name: client.name, workspace };
}

/**
 * Disconnects one MCP connection of the actor's user (see the contract): its consent, tokens
 * and the connection itself deleted in one transaction, then audited in the actor's workspace.
 * Other connections of the same client stay. 404 when it is not theirs (or already gone).
 */
export async function revokeClient(
	actor: WorkspaceActor,
	connectionId: string
): Promise<RevokedClient> {
	const { userId } = actor;
	const [connection] = await db
		.select({
			clientId: mcpConnection.clientId,
			label: mcpConnection.label
		})
		.from(mcpConnection)
		.where(and(eq(mcpConnection.id, connectionId), eq(mcpConnection.userId, userId)))
		.limit(1);
	if (!connection) {
		error(404, 'This client is not connected to your account.', { code: 'NOT_FOUND' });
	}
	const { clientId } = connection;
	const name = connection.label ?? (await registeredName(clientId)) ?? UNNAMED;
	const removed = await db.transaction(async (tx) => {
		const ofConnection = <
			T extends typeof oauthAccessToken | typeof oauthRefreshToken | typeof oauthConsent
		>(
			table: T
		) => and(eq(table.userId, userId), eq(table.referenceId, connectionId));
		// Access tokens first: those minted by a refresh token would cascade anyway
		const accessTokens = await tx
			.delete(oauthAccessToken)
			.where(ofConnection(oauthAccessToken))
			.returning({ id: oauthAccessToken.id });
		const refreshTokens = await tx
			.delete(oauthRefreshToken)
			.where(ofConnection(oauthRefreshToken))
			.returning({ id: oauthRefreshToken.id });
		const consents = await tx
			.delete(oauthConsent)
			.where(ofConnection(oauthConsent))
			.returning({ id: oauthConsent.id });
		await tx
			.delete(mcpConnection)
			.where(and(eq(mcpConnection.id, connectionId), eq(mcpConnection.userId, userId)));
		return {
			accessTokens: accessTokens.length,
			refreshTokens: refreshTokens.length,
			consents: consents.length
		};
	});
	connectionCache.delete(connectionId);
	await record({
		type: 'mcp_client.revoked',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		clientId,
		connectionId,
		clientName: name,
		metadata: removed
	});
	return { connectionId, clientId, name, ...removed };
}

/**
 * Services of the connectors the actor can see in the workspace (shared + their own), newest
 * first, one per name, with their logo
 */
async function visibleServers(actor: WorkspaceActor): Promise<OnboardingServer[]> {
	const rows = await db
		.select({
			id: connector.id,
			name: connector.name,
			source: connector.source,
			directoryId: connector.directoryId
		})
		.from(connector)
		.where(
			and(
				eq(connector.workspaceId, actor.workspaceId),
				or(isNull(connector.ownerUserId), eq(connector.ownerUserId, actor.userId))
			)
		)
		.orderBy(desc(connector.createdAt));
	const icons = await connectorIcons(rows);
	const servers = new Map<string, OnboardingServer>();
	for (const row of rows) {
		if (!servers.has(row.name))
			servers.set(row.name, { name: row.name, icon: icons.get(row.id) ?? null });
	}
	return [...servers.values()];
}

/** Audit events that prove an agent reached Toolkien through an MCP client */
export const FIRST_CALL_EVENTS = [
	'tools.searched',
	'tools.described',
	'execution.started',
	'tool.called'
] as const;

const TOOL_OF_EVENT: Record<(typeof FIRST_CALL_EVENTS)[number], string> = {
	'tools.searched': 'tools_search',
	'tools.described': 'tools_describe',
	'execution.started': 'execute',
	'tool.called': 'execute'
};

/** The user's first MCP tool call in the workspace (oldest matching audit event), if any */
export async function firstToolCall(actor: WorkspaceActor): Promise<FirstToolCall | null> {
	const [row] = await db
		.select({
			type: auditEvent.type,
			toolPath: auditEvent.toolPath,
			clientName: auditEvent.clientName,
			occurredAt: auditEvent.occurredAt
		})
		.from(auditEvent)
		.where(
			and(
				eq(auditEvent.workspaceId, actor.workspaceId),
				eq(auditEvent.userId, actor.userId),
				inArray(auditEvent.type, [...FIRST_CALL_EVENTS])
			)
		)
		.orderBy(asc(auditEvent.occurredAt))
		.limit(1);
	if (!row) return null;
	return {
		tool:
			row.type === 'tool.called' && row.toolPath
				? row.toolPath
				: TOOL_OF_EVENT[row.type as (typeof FIRST_CALL_EVENTS)[number]],
		clientName: row.clientName?.trim() || null,
		at: row.occurredAt
	};
}

/** Everything the connect page and the welcome checklist show (see the contract) */
export async function onboardingStatus(
	actor: WorkspaceActor,
	now = new Date()
): Promise<OnboardingStatus> {
	const workspaces = await listForUser(actor.userId);
	const [servers, clients, firstCall] = await Promise.all([
		visibleServers(actor),
		listAuthorizedClients(actor.userId, now, workspaces),
		firstToolCall(actor)
	]);
	return {
		mcpUrl: mcpUrl(),
		connectors: servers.map((server) => server.name),
		servers,
		clients,
		workspaces: workspaces.map(toClientWorkspace),
		triedPrompt: firstCall !== null,
		firstCall
	};
}

/** Whether the user still needs the connect guide: no connector and no authorized client */
export async function needsGuide(actor: WorkspaceActor, now = new Date()): Promise<boolean> {
	const [servers, clients] = await Promise.all([
		visibleServers(actor),
		listAuthorizedClients(actor.userId, now)
	]);
	return needsConnectGuide({ connectors: servers.map((server) => server.name), clients });
}
