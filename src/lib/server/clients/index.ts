import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { ORIGIN } from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import {
	auditEvent,
	connector,
	oauthAccessToken,
	oauthClient,
	oauthConsent,
	oauthRefreshToken
} from '#lib/server/db/schema/index.ts';
import type { WorkspaceActor } from '#lib/server/workspaces/types.ts';
import { needsConnectGuide, type AuthorizedClient, type OnboardingStatus } from './types.ts';

export type * from './types.ts';
export { needsConnectGuide } from './types.ts';

export const mcpUrl = () => `${ORIGIN}/mcp`;

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

	const [names, calls] = await Promise.all([
		db
			.select({ clientId: oauthClient.clientId, name: oauthClient.name })
			.from(oauthClient)
			.where(inArray(oauthClient.clientId, ids)),
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
	const lastCall = new Map(calls.map((row) => [row.clientId, toDate(row.last)]));

	return authorized
		.map(([clientId, value]) => {
			const tokens = value.tokens;
			return {
				clientId,
				name: nameOf.get(clientId) ?? 'Unnamed MCP client',
				connectedAt: earliest(value.consentedAt, ...tokens.map((token) => token.first)) ?? now,
				lastUsedAt: latest(...tokens.map((token) => token.last), lastCall.get(clientId))
			};
		})
		.sort(
			(a, b) =>
				(b.lastUsedAt ?? b.connectedAt).getTime() - (a.lastUsedAt ?? a.connectedAt).getTime()
		);
}

/** Names of the connectors the actor can see in the workspace (shared + their own) */
async function visibleConnectorNames(actor: WorkspaceActor): Promise<string[]> {
	const rows = await db
		.select({ name: connector.name, label: connector.label })
		.from(connector)
		.where(
			and(
				eq(connector.workspaceId, actor.workspaceId),
				or(isNull(connector.ownerUserId), eq(connector.ownerUserId, actor.userId))
			)
		)
		.orderBy(desc(connector.createdAt));
	return [...new Set(rows.map((row) => row.name))];
}

async function hasTriedPrompt(actor: WorkspaceActor): Promise<boolean> {
	const [row] = await db
		.select({ id: auditEvent.id })
		.from(auditEvent)
		.where(
			and(
				eq(auditEvent.workspaceId, actor.workspaceId),
				eq(auditEvent.userId, actor.userId),
				inArray(auditEvent.type, ['execution.started', 'tool.called'])
			)
		)
		.limit(1);
	return row !== undefined;
}

/** Everything the connect page and the welcome checklist show (see the contract) */
export async function onboardingStatus(
	actor: WorkspaceActor,
	now = new Date()
): Promise<OnboardingStatus> {
	const [connectors, clients, triedPrompt] = await Promise.all([
		visibleConnectorNames(actor),
		listAuthorizedClients(actor.userId, now),
		hasTriedPrompt(actor)
	]);
	return { mcpUrl: mcpUrl(), connectors, clients, triedPrompt };
}

/** Whether the user still needs the connect guide: no connector and no authorized client */
export async function needsGuide(actor: WorkspaceActor, now = new Date()): Promise<boolean> {
	const [connectors, clients] = await Promise.all([
		visibleConnectorNames(actor),
		listAuthorizedClients(actor.userId, now)
	]);
	return needsConnectGuide({ connectors, clients });
}
