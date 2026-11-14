/**
 * Connectors (upstream MCP servers configured in a workspace), their encrypted credentials,
 * upstream OAuth client registrations and the tool definitions they expose, versioned.
 *
 * Tool search uses the plain table `tool_search_text` (one normalized text per live tool),
 * kept in sync with `tool` / `tool_version` by the connectors module (no triggers: the text
 * depends on the connector name, label and the current version's description).
 */
import { sql } from 'drizzle-orm';
import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization, user } from './auth.ts';
import { createdAt, id, json, sealed, timestamp, updatedAt } from './columns.ts';

export const CONNECTOR_SCOPES = ['shared', 'personal'] as const;
/**
 * `shared`: authenticated once by an admin, members use it without seeing the token.
 * `personal`: every member authenticates their own account.
 */
export type ConnectorScope = (typeof CONNECTOR_SCOPES)[number];

export const CONNECTOR_SOURCES = ['directory', 'url'] as const;
export type ConnectorSource = (typeof CONNECTOR_SOURCES)[number];

/** `none` covers public servers that need no credentials */
export const CONNECTOR_AUTH_TYPES = ['oauth', 'token', 'none'] as const;
export type ConnectorAuthType = (typeof CONNECTOR_AUTH_TYPES)[number];

export const CONNECTOR_STATUSES = ['pending_auth', 'active', 'error', 'disabled'] as const;
export type ConnectorStatus = (typeof CONNECTOR_STATUSES)[number];

/** MCP tool annotations as received upstream (hints, not guarantees) */
export type ToolAnnotations = {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
};

export type JsonSchema = Record<string, unknown>;

export const connector = sqliteTable(
	'connector',
	{
		id: id(),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		scope: text('scope', { enum: CONNECTOR_SCOPES }).notNull(),
		/**
		 * Set when a member added the connector only for themselves (visible to them only).
		 * `null` = configured by an admin for the whole workspace.
		 */
		ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
		source: text('source', { enum: CONNECTOR_SOURCES }).notNull(),
		/** Curated directory entry id when `source = 'directory'` */
		directoryId: text('directory_id'),
		/** Streamable HTTP endpoint of the upstream MCP server (https only) */
		url: text('url').notNull(),
		name: text('name').notNull(),
		/**
		 * Instance label when the same server is added more than once (one per account or
		 * project: PostHog "DevMotion", PostHog "Devpost"). Shown next to the name, indexed for
		 * search and stated in the generated `.d.ts`.
		 */
		label: text('label'),
		/** camelCase namespace in the generated TypeScript (`gmail` in `gmail.searchThreads`) */
		namespace: text('namespace').notNull(),
		/** Free URLs are unverified: descriptions are flagged in `.d.ts` and UI */
		unverified: integer('unverified', { mode: 'boolean' }).notNull().default(false),
		authType: text('auth_type', { enum: CONNECTOR_AUTH_TYPES }).notNull(),
		status: text('status', { enum: CONNECTOR_STATUSES }).notNull().default('pending_auth'),
		/** Short, content-free reason shown in the UI (e.g. "upstream returned 401") */
		statusMessage: text('status_message'),
		/** Kill switch: configured but unusable until cleared */
		suspendedAt: timestamp('suspended_at'),
		lastSyncedAt: timestamp('last_synced_at'),
		/** MCP protocol version negotiated on the last sync (`2026-07-28`, `2025-11-25`, …) */
		protocolVersion: text('protocol_version'),
		/** Upstream `serverInfo` name/version reported on the last sync (metadata only) */
		serverInfo: json<{ name: string; version: string } | null>('server_info'),
		/** Upstream advertises `tools.listChanged`: a watcher listens for changes */
		toolsListChanged: integer('tools_list_changed', { mode: 'boolean' }).notNull().default(false),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		index('connector_workspace_idx').on(t.workspaceId),
		// Namespaces are unique among the connectors one user can see (NULLs are distinct in
		// SQLite unique indexes, hence two partial indexes)
		uniqueIndex('connector_namespace_shared_uq')
			.on(t.workspaceId, t.namespace)
			.where(sql`owner_user_id is null`),
		uniqueIndex('connector_namespace_owned_uq')
			.on(t.workspaceId, t.namespace, t.ownerUserId)
			.where(sql`owner_user_id is not null`)
	]
);

/**
 * Upstream credentials, sealed with the workspace data key. The sealed payload is a JSON
 * `{ accessToken, refreshToken?, tokenType? }` (or `{ token }` for API keys). Only the bridge
 * decrypts it, in memory, at call time. Never forwarded to the client and never logged.
 */
export const connectorCredential = sqliteTable(
	'connector_credential',
	{
		id: id(),
		connectorId: text('connector_id')
			.notNull()
			.references(() => connector.id, { onDelete: 'cascade' }),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		/** `null` for the single credential of a shared connector */
		userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['oauth', 'token'] }).notNull(),
		...sealed('secret'),
		/** Granted upstream scopes (metadata, not secret) */
		scope: text('scope'),
		/** Access token expiry; refresh ahead of it */
		expiresAt: timestamp('expires_at'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('connector_credential_shared_uq')
			.on(t.connectorId)
			.where(sql`user_id is null`),
		uniqueIndex('connector_credential_user_uq')
			.on(t.connectorId, t.userId)
			.where(sql`user_id is not null`)
	]
);

/**
 * How Toolkien is registered as an OAuth client at an upstream authorization server (DCR or
 * CIMD), one per connector. The client secret, when the upstream issued one, is sealed.
 */
export const upstreamOAuthClient = sqliteTable('upstream_oauth_client', {
	id: id(),
	connectorId: text('connector_id')
		.notNull()
		.unique()
		.references(() => connector.id, { onDelete: 'cascade' }),
	workspaceId: text('workspace_id')
		.notNull()
		.references(() => organization.id, { onDelete: 'cascade' }),
	/** Authorization server issuer */
	issuer: text('issuer').notNull(),
	clientId: text('client_id').notNull(),
	...sealed('clientSecret'),
	/** Cached RFC 8414 metadata (endpoints, supported methods) */
	serverMetadata: json<Record<string, unknown>>('server_metadata').notNull(),
	/** Registration response minus secrets (redirect URIs, auth method, scopes) */
	registration: json<Record<string, unknown>>('registration').notNull(),
	createdAt: createdAt(),
	updatedAt: updatedAt()
});

/**
 * An upstream OAuth authorization in progress (PKCE). The browser carries only `state`; the
 * table stores its SHA-256, the sealed code verifier and who started it, so the callback can
 * check the same signed-in user finishes it. Single use, deleted on callback, expires in 10 min.
 */
export const upstreamOAuthFlow = sqliteTable(
	'upstream_oauth_flow',
	{
		id: id(),
		stateHash: text('state_hash').notNull().unique(),
		connectorId: text('connector_id')
			.notNull()
			.references(() => connector.id, { onDelete: 'cascade' }),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		/** Who started the flow (must be the one completing it) */
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** Credential owner: `null` = the shared credential of the connector */
		credentialUserId: text('credential_user_id').references(() => user.id, {
			onDelete: 'cascade'
		}),
		...sealed('codeVerifier'),
		redirectUri: text('redirect_uri').notNull(),
		/** RFC 8707 resource indicator sent with the authorization request */
		resource: text('resource'),
		scope: text('scope'),
		/** Local path to return to after the callback (validated with `safeRedirectPath`) */
		returnTo: text('return_to').notNull(),
		expiresAt: timestamp('expires_at').notNull(),
		createdAt: createdAt()
	},
	(t) => [index('upstream_oauth_flow_expires_idx').on(t.expiresAt)]
);

/**
 * Stable identity of an upstream tool inside a connector. Definitions live in `tool_version`;
 * `currentVersion` points at the latest. `removedAt` is set when the upstream stops listing it.
 */
export const tool = sqliteTable(
	'tool',
	{
		id: id(),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		connectorId: text('connector_id')
			.notNull()
			.references(() => connector.id, { onDelete: 'cascade' }),
		/** Name as the upstream server reports it */
		upstreamName: text('upstream_name').notNull(),
		/** `namespace.camelCaseName`, unique among the tools a user can see in the workspace */
		path: text('path').notNull(),
		currentVersion: integer('current_version').notNull().default(1),
		removedAt: timestamp('removed_at'),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [
		uniqueIndex('tool_connector_name_uq').on(t.connectorId, t.upstreamName),
		index('tool_workspace_path_idx').on(t.workspaceId, t.path)
	]
);

/**
 * One saved definition per refresh that changed something. `signatureHash` (SHA-256 of the
 * canonical input/output schemas + annotations) is what permissions confirm: when it changes,
 * approved permissions go back to "to confirm".
 */
export const toolVersion = sqliteTable(
	'tool_version',
	{
		id: id(),
		toolId: text('tool_id')
			.notNull()
			.references(() => tool.id, { onDelete: 'cascade' }),
		version: integer('version').notNull(),
		title: text('title'),
		description: text('description'),
		inputSchema: json<JsonSchema>('input_schema').notNull(),
		outputSchema: json<JsonSchema | null>('output_schema'),
		annotations: json<ToolAnnotations | null>('annotations'),
		signatureHash: text('signature_hash').notNull(),
		createdAt: createdAt()
	},
	(t) => [uniqueIndex('tool_version_uq').on(t.toolId, t.version)]
);

/**
 * Favicon of a free-URL connector's server, fetched from its origin through `safeFetch` when the
 * connector is added or synced (directory connectors use the committed directory icon). Raster
 * only (PNG, ICO, WebP, JPEG, GIF: detected from the bytes, never SVG), at most 64 KB. A row
 * with `data = null` remembers that no icon was found, so syncs do not retry before
 * `fetchedAt` gets old. Served by `/connectors/icon/[id]` with `nosniff`.
 */
export const connectorIcon = sqliteTable('connector_icon', {
	connectorId: text('connector_id')
		.primaryKey()
		.references(() => connector.id, { onDelete: 'cascade' }),
	contentType: text('content_type'),
	data: blob('data', { mode: 'buffer' }),
	fetchedAt: timestamp('fetched_at').notNull()
});

/**
 * Search text of each live tool, rebuilt by the connectors module on every sync and rename
 * (`rebuildSearch`). `text` holds lowercased words separated by single spaces: tool name split
 * camelCase/snake_case, path, namespace, connector name, instance label, title, first line of
 * the description and directory tags. Searched with `LIKE '%word%'` per query word, so it works
 * the same on local SQLite and on Turso in MVCC mode (no virtual tables, hence no FTS5).
 */
export const toolSearchText = sqliteTable(
	'tool_search_text',
	{
		toolId: text('tool_id')
			.primaryKey()
			.references(() => tool.id, { onDelete: 'cascade' }),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		connectorId: text('connector_id')
			.notNull()
			.references(() => connector.id, { onDelete: 'cascade' }),
		text: text('text').notNull()
	},
	(t) => [
		index('tool_search_text_workspace_idx').on(t.workspaceId),
		index('tool_search_text_connector_idx').on(t.connectorId)
	]
);
