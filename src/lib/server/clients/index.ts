import { error } from '@sveltejs/kit';
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { ORIGIN } from '$app/env/private';
import { record } from '#lib/server/audit/index.ts';
import { connectorIcons } from '#lib/server/connectors/index.ts';
import { db } from '#lib/server/db/index.ts';
import {
	auditEvent,
	connector,
	mcpClientInfo,
	mcpClientLabel,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken
} from '#lib/server/db/schema/index.ts';
import type { WorkspaceActor } from '#lib/server/workspaces/types.ts';
import {
	cleanClientLabel,
	needsConnectGuide,
	type AuthorizedClient,
	type FirstToolCall,
	type OnboardingServer,
	type OnboardingStatus,
	type RevokedClient
} from './types.ts';

export type * from './types.ts';
export { CLIENT_LABEL_MAX, cleanClientLabel, needsConnectGuide } from './types.ts';

export const mcpUrl = () => `${ORIGIN}/mcp`;

const UNNAMED = 'Unnamed MCP client';

type Activity = { clientId: string; first: Date | null; last: Date | null; live: boolean };

const toDate = (value: number | null) => (value == null ? null : new Date(Number(value)));

/** Per client: first and last token issued, and whether one is still usable */
async function tokenActivity(
	table: typeof oauthAccessToken | typeof oauthRefreshToken,
	userId: string,
	now: number
): Promise<Activity[]> {
	const rows = await db
		.select({
			clientId: table.clientId,
			first: sql<number | null>`min(${table.createdAt})`,
			last: sql<number | null>`max(${table.createdAt})`,
			live: sql<number>`max(case when ${table.revoked} is null and ${table.expiresAt} > ${now} then 1 else 0 end)`
		})
		.from(table)
		.where(eq(table.userId, userId))
		.groupBy(table.clientId);
	return rows.map((row) => ({
		clientId: row.clientId,
		first: toDate(row.first),
		last: toDate(row.last),
		live: Number(row.live) === 1
	}));
}

const latest = (...dates: (Date | null | undefined)[]) =>
	dates.reduce<Date | null>((max, date) => (date && (!max || date > max) ? date : max), null);
const earliest = (...dates: (Date | null | undefined)[]) =>
	dates.reduce<Date | null>((min, date) => (date && (!min || date < min) ? date : min), null);

/** MCP clients the user has authorized (see the contract), most recently used first */
export async function listAuthorizedClients(
	userId: string,
	now = new Date()
): Promise<AuthorizedClient[]> {
	const [consents, access, refresh] = await Promise.all([
		db
			.select({ clientId: oauthConsent.clientId, createdAt: oauthConsent.createdAt })
			.from(oauthConsent)
			.where(eq(oauthConsent.userId, userId)),
		tokenActivity(oauthAccessToken, userId, now.getTime()),
		tokenActivity(oauthRefreshToken, userId, now.getTime())
	]);

	const byClient = new Map<string, { consentedAt: Date | null; tokens: Activity[] }>();
	const entry = (clientId: string) => {
		let value = byClient.get(clientId);
		if (!value) byClient.set(clientId, (value = { consentedAt: null, tokens: [] }));
		return value;
	};
	for (const consent of consents) entry(consent.clientId).consentedAt = consent.createdAt;
	for (const activity of [...access, ...refresh]) entry(activity.clientId).tokens.push(activity);

	const authorized = [...byClient].filter(
		([, value]) => value.consentedAt !== null || value.tokens.some((token) => token.live)
	);
	if (authorized.length === 0) return [];
	const ids = authorized.map(([clientId]) => clientId);

	const [names, labels, calls] = await Promise.all([
		db
			.select({ clientId: oauthClient.clientId, name: oauthClient.name })
			.from(oauthClient)
			.where(inArray(oauthClient.clientId, ids)),
		db
			.select({ clientId: mcpClientLabel.clientId, label: mcpClientLabel.label })
			.from(mcpClientLabel)
			.where(and(eq(mcpClientLabel.userId, userId), inArray(mcpClientLabel.clientId, ids))),
		db
			.select({
				clientId: auditEvent.clientId,
				last: sql<number | null>`max(${auditEvent.occurredAt})`
			})
			.from(auditEvent)
			.where(and(eq(auditEvent.userId, userId), inArray(auditEvent.clientId, ids)))
			.groupBy(auditEvent.clientId)
	]);
	const nameOf = new Map(names.map((row) => [row.clientId, row.name?.trim() || null]));
	const labelOf = new Map(labels.map((row) => [row.clientId, row.label]));
	const lastCall = new Map(calls.map((row) => [row.clientId, toDate(row.last)]));

	return authorized
		.map(([clientId, value]) => {
			const tokens = value.tokens;
			const registeredName = nameOf.get(clientId) ?? null;
			return {
				clientId,
				name: labelOf.get(clientId) ?? registeredName ?? UNNAMED,
				registeredName,
				connectedAt: earliest(value.consentedAt, ...tokens.map((token) => token.first)) ?? now,
				lastUsedAt: latest(...tokens.map((token) => token.last), lastCall.get(clientId))
			};
		})
		.sort(
			(a, b) =>
				(b.lastUsedAt ?? b.connectedAt).getTime() - (a.lastUsedAt ?? a.connectedAt).getTime()
		);
}

/**
 * Whether the user still grants this client access: a stored consent, or a live refresh token.
 * `/mcp` checks it on every request, so a disconnect also stops access tokens already issued.
 */
export async function hasLiveGrant(
	userId: string,
	clientId: string,
	now = new Date()
): Promise<boolean> {
	const [consents, refresh] = await Promise.all([
		db
			.select({ id: oauthConsent.id })
			.from(oauthConsent)
			.where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
			.limit(1),
		db
			.select({ id: oauthRefreshToken.id })
			.from(oauthRefreshToken)
			.where(
				and(
					eq(oauthRefreshToken.userId, userId),
					eq(oauthRefreshToken.clientId, clientId),
					isNull(oauthRefreshToken.revoked),
					gt(oauthRefreshToken.expiresAt, now)
				)
			)
			.limit(1)
	]);
	return consents.length > 0 || refresh.length > 0;
}

/**
 * Remembers the MCP `clientInfo` (`name version`) a client sent in `initialize`, so its later
 * stateless requests are labelled with it in the activity. Display-only metadata.
 */
export async function rememberClientInfo(userId: string, clientId: string, info: string) {
	await db
		.insert(mcpClientInfo)
		.values({ userId, clientId, info })
		.onConflictDoUpdate({
			target: [mcpClientInfo.userId, mcpClientInfo.clientId],
			set: { info, updatedAt: new Date() }
		});
}

/** The client info remembered by `rememberClientInfo`, if any */
export async function storedClientInfo(userId: string, clientId: string): Promise<string | null> {
	const [row] = await db
		.select({ info: mcpClientInfo.info })
		.from(mcpClientInfo)
		.where(and(eq(mcpClientInfo.userId, userId), eq(mcpClientInfo.clientId, clientId)))
		.limit(1);
	return row?.info ?? null;
}

/**
 * Client names by user and client: `/mcp` reads one on every request, so they are cached a
 * minute; writes here update the cache at once.
 */
const labelCache = new Map<string, { at: number; value: string | null }>();
const LABEL_CACHE_MS = 60_000;
const LABEL_CACHE_MAX = 5_000;
const labelKey = (userId: string, clientId: string) => `${userId}\0${clientId}`;
const cacheLabel = (userId: string, clientId: string, value: string | null) => {
	if (labelCache.size >= LABEL_CACHE_MAX) labelCache.clear();
	labelCache.set(labelKey(userId, clientId), { at: Date.now(), value });
};

/** The name the user gave this client, if any (see the contract) */
export async function clientLabel(userId: string, clientId: string): Promise<string | null> {
	const cached = labelCache.get(labelKey(userId, clientId));
	if (cached && Date.now() - cached.at < LABEL_CACHE_MS) return cached.value;
	const [row] = await db
		.select({ label: mcpClientLabel.label })
		.from(mcpClientLabel)
		.where(and(eq(mcpClientLabel.userId, userId), eq(mcpClientLabel.clientId, clientId)))
		.limit(1);
	const value = row?.label ?? null;
	cacheLabel(userId, clientId, value);
	return value;
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

/**
 * Stores the user's name for a client, without checks or audit (the consent screen, before the
 * client is authorized). Empty, or equal to the registered name, clears it. Returns the name the
 * client is shown with from now on.
 */
export async function storeClientLabel(
	userId: string,
	clientId: string,
	input: string | null
): Promise<string> {
	const registered = await registeredName(clientId);
	const cleaned = cleanClientLabel(input);
	const label = cleaned && cleaned !== registered ? cleaned : null;
	if (label) {
		await db
			.insert(mcpClientLabel)
			.values({ userId, clientId, label })
			.onConflictDoUpdate({
				target: [mcpClientLabel.userId, mcpClientLabel.clientId],
				set: { label, updatedAt: new Date() }
			});
	} else {
		await db
			.delete(mcpClientLabel)
			.where(and(eq(mcpClientLabel.userId, userId), eq(mcpClientLabel.clientId, clientId)));
	}
	cacheLabel(userId, clientId, label);
	return label ?? registered ?? UNNAMED;
}

/**
 * Renames one of the actor's authorized clients (see the contract), audited in the actor's
 * workspace. 404 when the user has not authorized it.
 */
export async function setClientLabel(
	actor: WorkspaceActor,
	clientId: string,
	input: string | null
): Promise<{ clientId: string; name: string }> {
	const clients = await listAuthorizedClients(actor.userId);
	const current = clients.find((client) => client.clientId === clientId);
	if (!current) {
		error(404, 'This client is not connected to your account.', { code: 'NOT_FOUND' });
	}
	const name = await storeClientLabel(actor.userId, clientId, input);
	if (name !== current.name) {
		await record({
			type: 'mcp_client.renamed',
			outcome: 'success',
			workspaceId: actor.workspaceId,
			userId: actor.userId,
			clientId,
			clientName: name,
			metadata: { previousName: current.name }
		});
	}
	return { clientId, name };
}

/**
 * Disconnects an MCP client for the actor's user only (see the contract): consent and every
 * access/refresh token deleted in one transaction, then audited in the actor's workspace. 404
 * when the user never authorized it (or it was already disconnected).
 */
export async function revokeClient(
	actor: WorkspaceActor,
	clientId: string
): Promise<RevokedClient> {
	const { userId } = actor;
	const name = (await clientLabel(userId, clientId)) ?? (await registeredName(clientId)) ?? UNNAMED;
	const removed = await db.transaction(async (tx) => {
		// Access tokens first: those minted by a refresh token would cascade anyway
		const accessTokens = await tx
			.delete(oauthAccessToken)
			.where(and(eq(oauthAccessToken.userId, userId), eq(oauthAccessToken.clientId, clientId)))
			.returning({ id: oauthAccessToken.id });
		const refreshTokens = await tx
			.delete(oauthRefreshToken)
			.where(and(eq(oauthRefreshToken.userId, userId), eq(oauthRefreshToken.clientId, clientId)))
			.returning({ id: oauthRefreshToken.id });
		const consents = await tx
			.delete(oauthConsent)
			.where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId)))
			.returning({ id: oauthConsent.id });
		await tx
			.delete(mcpClientInfo)
			.where(and(eq(mcpClientInfo.userId, userId), eq(mcpClientInfo.clientId, clientId)));
		await tx
			.delete(mcpClientLabel)
			.where(and(eq(mcpClientLabel.userId, userId), eq(mcpClientLabel.clientId, clientId)));
		return {
			accessTokens: accessTokens.length,
			refreshTokens: refreshTokens.length,
			consents: consents.length
		};
	});
	if (removed.accessTokens + removed.refreshTokens + removed.consents === 0) {
		error(404, 'This client is not connected to your account.', { code: 'NOT_FOUND' });
	}
	labelCache.delete(labelKey(userId, clientId));
	await record({
		type: 'mcp_client.revoked',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		clientId,
		clientName: name,
		metadata: removed
	});
	return { clientId, name, ...removed };
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
	const [servers, clients, firstCall] = await Promise.all([
		visibleServers(actor),
		listAuthorizedClients(actor.userId, now),
		firstToolCall(actor)
	]);
	return {
		mcpUrl: mcpUrl(),
		connectors: servers.map((server) => server.name),
		servers,
		clients,
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
