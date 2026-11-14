import { error } from '@sveltejs/kit';
import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import { connector, connectorCredential, tool, toolVersion } from '#lib/server/db/schema/index.ts';
import { assertSafeUrl, UnsafeUrlError } from '#lib/server/net/index.ts';
import {
	moduleDeclaration,
	toNamespace,
	toolDeclaration,
	uniqueName
} from '#lib/server/typegen/index.ts';
import { checkConnectorPolicy, getById, getPolicy } from '#lib/server/workspaces/index.ts';
import type { WorkspaceActor } from '#lib/server/workspaces/types.ts';
import {
	assertCanAuthenticate,
	assertCanManage,
	canAuthenticate,
	canManage,
	credentialUserId,
	getVisible,
	isAdmin,
	visibleTo,
	type ConnectorRow
} from './access.ts';
import {
	deleteCredential,
	findCredential,
	listCredentials,
	openCredential,
	saveCredential
} from './credentials.ts';
import { getDirectoryEntry } from './directory.ts';
import { resolveTool, summaryOf, toTypeInput, type ToolRecord } from './discovery.ts';
import {
	completeUpstreamOAuth,
	revokeUpstreamTokens,
	startUpstreamOAuth,
	supportsOAuth
} from './oauth.ts';
import { upstreamCredential } from './session.ts';
import { rebuildSearch, syncConnector } from './sync.ts';
import type {
	ConnectorDetail,
	ConnectorsService,
	ConnectorSummary,
	ConnectorTool,
	UpstreamCallResult
} from './types.ts';
import { callUpstreamTool, listTools, UpstreamError } from './upstream.ts';
import { ensureWatch, stopWatch } from './watch.ts';

/** Definitions older than this are reloaded when a session opens */
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const deny = (message: string): never => error(403, message, { code: 'POLICY_DENIED' });

async function summaries(actor: WorkspaceActor, rows: ConnectorRow[]): Promise<ConnectorSummary[]> {
	if (rows.length === 0) return [];
	const ids = rows.map((r) => r.id);
	const counts = await db
		.select({ connectorId: tool.connectorId, n: count() })
		.from(tool)
		.where(and(inArray(tool.connectorId, ids), isNull(tool.removedAt)))
		.groupBy(tool.connectorId);
	const credentials = await db
		.select({ connectorId: connectorCredential.connectorId, userId: connectorCredential.userId })
		.from(connectorCredential)
		.where(
			and(
				inArray(connectorCredential.connectorId, ids),
				or(isNull(connectorCredential.userId), eq(connectorCredential.userId, actor.userId))
			)
		);
	const toolCount = new Map(counts.map((c) => [c.connectorId, c.n]));
	return rows.map((row) => {
		const owner = credentialUserId(actor, row);
		return {
			id: row.id,
			workspaceId: row.workspaceId,
			name: row.name,
			label: row.label,
			displayName: displayName(row),
			namespace: row.namespace,
			scope: row.scope,
			ownerUserId: row.ownerUserId,
			source: row.source,
			directoryId: row.directoryId,
			url: row.url,
			unverified: row.unverified,
			authType: row.authType,
			status: row.status,
			statusMessage: row.statusMessage,
			suspended: row.suspendedAt !== null,
			authenticated:
				row.authType === 'none' ||
				credentials.some((c) => c.connectorId === row.id && c.userId === owner),
			toolCount: toolCount.get(row.id) ?? 0,
			lastSyncedAt: row.lastSyncedAt,
			canManage: canManage(actor, row),
			canAuthenticate: canAuthenticate(actor, row),
			protocolVersion: row.protocolVersion
		};
	});
}

export const list: ConnectorsService['list'] = async (actor) => {
	const rows = await db.select().from(connector).where(visibleTo(actor)).orderBy(connector.name);
	return summaries(actor, rows);
};

export const get: ConnectorsService['get'] = async (actor, connectorId) => {
	const row = await getVisible(actor, connectorId);
	const [summary] = await summaries(actor, [row]);
	const entry = row.source === 'directory' ? getDirectoryEntry(row.directoryId) : null;
	const rows = await db
		.select({
			tool,
			version: toolVersion,
			previousDescription: sql<
				string | null
			>`(select pv.description from tool_version pv where pv.tool_id = ${tool.id} and pv.version = ${tool.currentVersion} - 1)`,
			hasPrevious: sql<number>`(select count(*) from tool_version pv where pv.tool_id = ${tool.id} and pv.version = ${tool.currentVersion} - 1)`
		})
		.from(tool)
		.innerJoin(
			toolVersion,
			and(eq(toolVersion.toolId, tool.id), eq(toolVersion.version, tool.currentVersion))
		)
		.where(eq(tool.connectorId, row.id))
		.orderBy(tool.path);
	const tools: ConnectorTool[] = [];
	for (const r of rows) {
		const record: ToolRecord = {
			id: r.tool.id,
			path: r.tool.path,
			upstreamName: r.tool.upstreamName,
			connectorId: row.id,
			connectorName: row.name,
			label: row.label,
			namespace: row.namespace,
			source: row.source,
			unverified: row.unverified,
			title: r.version.title,
			description: r.version.description,
			inputSchema: r.version.inputSchema,
			outputSchema: r.version.outputSchema,
			annotations: r.version.annotations,
			signatureHash: r.version.signatureHash,
			version: r.version.version
		};
		tools.push({
			id: record.id,
			path: record.path,
			upstreamName: record.upstreamName,
			title: record.title,
			summary: summaryOf({ ...record, unverified: false, label: null }),
			description: record.description,
			declaration: await toolDeclaration(toTypeInput(record)),
			annotations: record.annotations,
			version: record.version,
			signatureHash: record.signatureHash,
			descriptionChanged:
				Number(r.hasPrevious) > 0 && (r.previousDescription ?? null) !== record.description,
			note: entry?.toolNotes[record.upstreamName] ?? null,
			removed: r.tool.removedAt !== null,
			updatedAt: r.tool.updatedAt
		});
	}
	return {
		...summary,
		serverInfo: row.serverInfo ?? null,
		directory: entry,
		tools
	} satisfies ConnectorDetail;
};

/** `mcp.acme.example` → `acme`: the prefix used when a namespace is taken */
function hostPrefix(url: string) {
	const labels = new URL(url).hostname
		.split('.')
		.filter((l) => !['mcp', 'api', 'www', 'app'].includes(l));
	return labels.length > 1 ? labels[labels.length - 2] : (labels[0] ?? 'remote');
}

/** Namespaces are unique in the whole workspace (personal ones included), so paths never clash */
async function takenNamespaces(workspaceId: string, exceptConnectorId?: string) {
	const rows = await db
		.select({ id: connector.id, namespace: connector.namespace })
		.from(connector)
		.where(eq(connector.workspaceId, workspaceId));
	return new Set(rows.filter((r) => r.id !== exceptConnectorId).map((r) => r.namespace));
}

const cleanLabel = (label: string | null | undefined) => {
	const value = label?.replace(/\s+/g, ' ').trim().slice(0, 60);
	return value ? value : null;
};

/** An explicit namespace must already be a valid one (no silent rewriting of user input) */
function assertNamespace(namespace: string, taken: Set<string>) {
	if (!/^[a-z][A-Za-z0-9]{0,39}$/.test(namespace) || toNamespace(namespace) !== namespace) {
		error(400, 'Use a camelCase namespace (letters and digits, starting lowercase).', {
			code: 'INVALID_INPUT'
		});
	}
	if (taken.has(namespace)) {
		error(409, `The namespace "${namespace}" is already used in this workspace.`, {
			code: 'CONFLICT'
		});
	}
}

export const displayName = (row: Pick<ConnectorRow, 'name' | 'label'>) =>
	row.label ? `${row.name} (${row.label})` : row.name;

function serverAllowed(allowed: string[] | null, url: string, directoryId: string | null) {
	if (allowed === null) return true;
	const origin = new URL(url).origin;
	return allowed.includes(origin) || (directoryId !== null && allowed.includes(directoryId));
}

export const add: ConnectorsService['add'] = async (actor, input) => {
	const onlyForMe = input.onlyForMe;
	if (!onlyForMe && !isAdmin(actor)) {
		error(403, 'Only workspace admins can add connectors for everyone.', { code: 'FORBIDDEN' });
	}
	const policy = await getPolicy(actor.workspaceId);
	// Admin policy (org-ops, single source): personal connectors, free URLs, allowed servers
	const check = checkConnectorPolicy(policy, actor.role, {
		onlyForMe,
		source:
			input.source.type === 'directory'
				? { type: 'directory', directoryId: input.source.directoryId }
				: { type: 'url', url: input.source.url.trim() }
	});
	if (!check.allowed) deny(check.reason);

	let url: string;
	let name: string;
	let desired: string;
	let authType: ConnectorRow['authType'];
	let unverified: boolean;
	let directoryId: string | null = null;
	if (input.source.type === 'directory') {
		const entry = getDirectoryEntry(input.source.directoryId);
		if (!entry) error(404, 'Directory server not found.', { code: 'NOT_FOUND' });
		url = entry.url;
		name = input.name?.trim() || entry.name;
		desired = entry.namespace;
		authType = input.authType ?? entry.authType;
		unverified = entry.verification.status === 'unverified';
		directoryId = entry.id;
	} else {
		let safe: URL;
		try {
			safe = await assertSafeUrl(input.source.url.trim());
		} catch (cause) {
			const reason = cause instanceof UnsafeUrlError ? cause.reason : 'invalid_url';
			error(400, `This URL cannot be used (${reason.replace(/_/g, ' ')}).`, {
				code: 'INVALID_INPUT'
			});
		}
		if (safe.protocol !== 'https:')
			error(400, 'Only https URLs are allowed.', { code: 'INVALID_INPUT' });
		safe.hash = '';
		url = safe.href;
		name = input.name?.trim() || safe.hostname;
		desired = toNamespace(input.name?.trim() || hostPrefix(url));
		authType = input.authType ?? ((await supportsOAuth(url)) ? 'oauth' : 'none');
		unverified = true;
	}
	if (!serverAllowed(policy.allowedServers, url, directoryId)) {
		deny('This server is not in the workspace allow-list.');
	}

	const label = cleanLabel(input.label);
	const taken = await takenNamespaces(actor.workspaceId);
	let namespace: string;
	if (input.namespace?.trim()) {
		namespace = input.namespace.trim();
		assertNamespace(namespace, taken);
	} else {
		// One instance per account/project: `posthog` + `DevMotion` → `posthogDevmotion`
		namespace = uniqueName(
			toNamespace(label ? `${desired} ${label.toLowerCase()}` : desired),
			taken,
			hostPrefix(url)
		);
	}
	let row: ConnectorRow;
	try {
		[row] = await db
			.insert(connector)
			.values({
				workspaceId: actor.workspaceId,
				scope: onlyForMe ? 'personal' : input.scope,
				ownerUserId: onlyForMe ? actor.userId : null,
				source: input.source.type,
				directoryId,
				url,
				name: name.slice(0, 80),
				label,
				namespace,
				unverified,
				authType,
				status: authType === 'none' ? 'active' : 'pending_auth',
				createdBy: actor.userId
			})
			.returning();
	} catch {
		error(409, 'A connector with this namespace already exists. Try again.', { code: 'CONFLICT' });
	}
	await record({
		type: 'connector.added',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		connectorId: row.id,
		metadata: { source: row.source, scope: row.scope, unverified, directoryId, authType }
	});
	if (authType === 'none') {
		await syncConnector(row, null, 'manual', actor.userId).catch(() => undefined);
	}
	const [summary] = await summaries(actor, [await getVisible(actor, row.id)]);
	return summary;
};

export const rename: ConnectorsService['rename'] = async (actor, connectorId, input) => {
	const row = await getVisible(actor, connectorId);
	assertCanManage(actor, row);
	const label = input.label === undefined ? row.label : cleanLabel(input.label);
	const name = input.name?.trim() ? input.name.trim().slice(0, 80) : row.name;
	const namespace = input.namespace?.trim() || row.namespace;
	if (namespace !== row.namespace) {
		assertNamespace(namespace, await takenNamespaces(actor.workspaceId, row.id));
	}
	await db.transaction(async (tx) => {
		const [updated] = await tx
			.update(connector)
			.set({ label, name, namespace })
			.where(eq(connector.id, row.id))
			.returning();
		if (namespace !== row.namespace) {
			// `posthog.query` → `posthogDevmotion.query`: ids (and so permissions) do not change
			await tx
				.update(tool)
				.set({
					path: sql`${namespace} || substr(${tool.path}, ${row.namespace.length + 1})`
				})
				.where(eq(tool.connectorId, row.id));
		}
		await rebuildSearch(tx, updated);
	});
	await record({
		type: 'connector.synced',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		connectorId: row.id,
		metadata: { reason: 'renamed', namespaceChanged: namespace !== row.namespace }
	});
	const [summary] = await summaries(actor, [await getVisible(actor, row.id)]);
	return summary;
};

async function revokeAndDelete(row: ConnectorRow, userId: string | null) {
	const credential = await findCredential(row.id, userId);
	if (!credential) return false;
	if (credential.kind === 'oauth') {
		const secret = await openCredential(credential).catch(() => null);
		if (secret && 'accessToken' in secret) await revokeUpstreamTokens(row, secret);
	}
	await deleteCredential(row.id, userId);
	return true;
}

export const revokeUserCredentials: ConnectorsService['revokeUserCredentials'] = async (
	workspaceId,
	userId
) => {
	const rows = await db
		.select({ row: connector })
		.from(connectorCredential)
		.innerJoin(connector, eq(connector.id, connectorCredential.connectorId))
		.where(
			and(eq(connectorCredential.workspaceId, workspaceId), eq(connectorCredential.userId, userId))
		);
	let deleted = 0;
	for (const { row } of rows) {
		try {
			if (await revokeAndDelete(row, userId)) deleted++;
		} catch {
			console.error('[connectors] credential revocation failed, deleting locally');
			await deleteCredential(row.id, userId);
			deleted++;
		}
	}
	return deleted;
};

export const remove: ConnectorsService['remove'] = async (actor, connectorId) => {
	const row = await getVisible(actor, connectorId);
	assertCanManage(actor, row);
	await stopWatch(row.id);
	for (const credential of await listCredentials(row.id)) {
		await revokeAndDelete(row, credential.userId);
	}
	await db.run(
		sql`DELETE FROM tool_search WHERE tool_id IN (SELECT id FROM tool WHERE connector_id = ${row.id})`
	);
	await db.delete(connector).where(eq(connector.id, row.id));
	await record({
		type: 'connector.removed',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		connectorId: row.id,
		metadata: { source: row.source, scope: row.scope }
	});
};

export const disconnect: ConnectorsService['disconnect'] = async (actor, connectorId) => {
	const row = await getVisible(actor, connectorId);
	assertCanAuthenticate(actor, row);
	const owner = credentialUserId(actor, row);
	const removed = await revokeAndDelete(row, owner);
	if (owner === null) {
		await stopWatch(row.id);
		if (row.authType !== 'none') {
			await db
				.update(connector)
				.set({ status: 'pending_auth', statusMessage: null })
				.where(eq(connector.id, row.id));
		}
	}
	if (removed) {
		await record({
			type: 'connector.authenticated',
			outcome: 'success',
			workspaceId: actor.workspaceId,
			userId: actor.userId,
			connectorId: row.id,
			metadata: { action: 'disconnected', shared: owner === null }
		});
	}
};

export const startOAuth: ConnectorsService['startOAuth'] = async (actor, connectorId, returnTo) => {
	const row = await getVisible(actor, connectorId);
	assertCanAuthenticate(actor, row);
	if (row.suspendedAt) error(409, 'This connector is suspended.', { code: 'SUSPENDED' });
	if (row.authType !== 'oauth')
		error(400, 'This connector does not use OAuth.', { code: 'INVALID_INPUT' });
	return startUpstreamOAuth({
		conn: row,
		entry: row.source === 'directory' ? getDirectoryEntry(row.directoryId) : null,
		userId: actor.userId,
		credentialUserId: credentialUserId(actor, row),
		returnTo
	});
};

async function afterAuthentication(row: ConnectorRow, owner: string | null, actorUserId: string) {
	await record({
		type: 'connector.authenticated',
		outcome: 'success',
		workspaceId: row.workspaceId,
		userId: actorUserId,
		connectorId: row.id,
		metadata: { authType: row.authType, shared: owner === null }
	});
	const fresh =
		(await db.select().from(connector).where(eq(connector.id, row.id)).limit(1))[0] ?? row;
	try {
		await syncConnector(fresh, owner, 'manual', actorUserId);
		const synced = (await db.select().from(connector).where(eq(connector.id, row.id)).limit(1))[0];
		if (synced) void ensureWatch(synced, owner, () => scheduleSync(synced, owner));
	} catch {
		// The status message tells the user what went wrong
	}
}

export const completeOAuth: ConnectorsService['completeOAuth'] = async (state, code, opts = {}) => {
	const flow = await completeUpstreamOAuth(state, code, opts);
	const [row] = await db
		.select()
		.from(connector)
		.where(eq(connector.id, flow.connectorId))
		.limit(1);
	if (!row) error(404, 'Connector not found.', { code: 'NOT_FOUND' });
	// The user must still be a member with the right to authenticate this credential
	const workspace = await getById(flow.userId, flow.workspaceId);
	if (!workspace)
		error(403, 'You are no longer a member of this workspace.', { code: 'FORBIDDEN' });
	assertCanAuthenticate(
		{ workspaceId: workspace.id, userId: flow.userId, role: workspace.role },
		row
	);
	await saveCredential(row, flow.credentialUserId, 'oauth', flow.secret, {
		scope: flow.scope,
		expiresAt: flow.expiresAt
	});
	await afterAuthentication(row, flow.credentialUserId, flow.userId);
	return { workspaceId: flow.workspaceId, connectorId: flow.connectorId, returnTo: flow.returnTo };
};

export const setToken: ConnectorsService['setToken'] = async (actor, connectorId, rawToken) => {
	let row = await getVisible(actor, connectorId);
	assertCanAuthenticate(actor, row);
	const token = rawToken.trim().replace(/^Bearer\s+/i, '');
	if (!token || token.length > 8192 || /\s/.test(token)) {
		error(400, 'Paste the token without spaces.', { code: 'INVALID_INPUT' });
	}
	if (row.authType === 'oauth' && !canManage(actor, row)) {
		error(400, 'This connector uses OAuth: connect your account instead.', {
			code: 'INVALID_INPUT'
		});
	}
	// Validate before storing: a rejected token is never saved
	try {
		await listTools({ url: row.url, credential: { token } });
	} catch (cause) {
		if (cause instanceof UpstreamError && cause.code === 'auth_required') {
			error(400, 'The server rejected this token.', { code: 'INVALID_INPUT' });
		}
		error(
			424,
			`${row.name}: ${cause instanceof UpstreamError ? cause.message : 'Could not talk to the MCP server.'}`,
			{ code: 'GENERIC' }
		);
	}
	if (row.authType !== 'token') {
		[row] = await db
			.update(connector)
			.set({ authType: 'token' })
			.where(eq(connector.id, row.id))
			.returning();
	}
	const owner = credentialUserId(actor, row);
	await saveCredential(row, owner, 'token', { token });
	await afterAuthentication(row, owner, actor.userId);
};

/** Background sync after `list_changed` (no user waiting) */
function scheduleSync(row: ConnectorRow, owner: string | null) {
	void syncConnector(row, owner, 'list_changed', null).catch(() => undefined);
}

export const syncTools: ConnectorsService['syncTools'] = async (actor, connectorId, reason) => {
	const row = await getVisible(actor, connectorId);
	const owner = credentialUserId(actor, row);
	const result = await syncConnector(row, owner, reason, actor.userId);
	const synced = await getVisible(actor, connectorId);
	void ensureWatch(synced, owner, () => scheduleSync(synced, owner));
	return result;
};

export const refreshStale: ConnectorsService['refreshStale'] = async (actor) => {
	const rows = await db
		.select()
		.from(connector)
		.where(
			and(visibleTo(actor), isNull(connector.suspendedAt), sql`${connector.status} <> 'disabled'`)
		);
	const now = Date.now();
	await Promise.allSettled(
		rows.map(async (row) => {
			const owner = credentialUserId(actor, row);
			if (row.authType !== 'none' && !(await findCredential(row.id, owner))) return;
			const stale = !row.lastSyncedAt || now - row.lastSyncedAt.getTime() > CACHE_TTL_MS;
			if (stale) {
				await syncConnector(
					row,
					owner,
					row.lastSyncedAt ? 'cache_expired' : 'session',
					actor.userId
				);
			}
			const current = await getVisible(actor, row.id);
			await ensureWatch(current, owner, () => scheduleSync(current, owner));
		})
	);
};

export const callTool: ConnectorsService['callTool'] = async (actor, resolved, args) => {
	const [row] = await db
		.select()
		.from(connector)
		.where(and(eq(connector.id, resolved.connectorId), visibleTo(actor)))
		.limit(1);
	if (!row)
		return { ok: false, code: 'upstream_error', message: 'This connector is not available.' };
	if (row.suspendedAt)
		return { ok: false, code: 'upstream_error', message: `${row.name} is suspended.` };
	const owner = credentialUserId(actor, row);
	const reconnect: UpstreamCallResult = {
		ok: false,
		code: 'auth_required',
		message: `${row.name} needs to be connected: open Connectors in Toolkien and connect it.`
	};

	const credential = await upstreamCredential(row, owner);
	if (credential === 'missing') return reconnect;
	const definition = {
		name: resolved.upstreamName,
		inputSchema: resolved.inputSchema,
		outputSchema: resolved.outputSchema
	};
	const options = { url: row.url, onToolsChanged: () => scheduleSync(row, owner) };
	let result = await callUpstreamTool({ ...options, credential }, definition, args);

	if (!result.ok && result.code === 'auth_required' && credential) {
		const refreshed = await upstreamCredential(row, owner, { forceRefresh: true });
		if (refreshed === 'missing' || !refreshed) return reconnect;
		result = await callUpstreamTool({ ...options, credential: refreshed }, definition, args);
		if (!result.ok && result.code === 'auth_required') return reconnect;
	}

	if (!result.ok && (result.code === 'unknown_tool' || result.code === 'invalid_params')) {
		await syncConnector(row, owner, 'call_error', actor.userId).catch(() => undefined);
		const fresh = await resolveTool(actor, resolved.path);
		if (!fresh) {
			return {
				...result,
				message: `${result.message}\n\n${resolved.path} no longer exists on the server. Search the tools again.`
			};
		}
		const declaration = await moduleDeclaration([
			toTypeInput({
				id: fresh.toolId,
				path: fresh.path,
				upstreamName: fresh.upstreamName,
				connectorId: row.id,
				connectorName: row.name,
				label: row.label,
				namespace: row.namespace,
				source: row.source,
				unverified: row.unverified,
				title: null,
				description: null,
				inputSchema: fresh.inputSchema,
				outputSchema: fresh.outputSchema,
				annotations: fresh.annotations,
				signatureHash: fresh.signatureHash,
				version: 0
			})
		]);
		const changed = fresh.signatureHash !== resolved.signatureHash;
		return {
			...result,
			message: `${result.message}\n\n${changed ? 'The tool definition changed upstream and was refreshed.' : 'Definitions were refreshed.'} Current signature of ${fresh.path}:\n${declaration}`
		};
	}
	return result;
};
