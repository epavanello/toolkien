/**
 * Connectors (upstream MCP servers configured in a workspace), their encrypted credentials,
 * upstream OAuth client registrations and the tool definitions they expose, versioned.
 *
 * Full-text search over tools uses the FTS5 virtual table `tool_search` (columns `tool_id`
 * UNINDEXED, `workspace_id` UNINDEXED, `path`, `description`), created by a custom SQL
 * migration because drizzle-kit cannot express virtual tables. The connectors module keeps it
 * in sync with `tool` / `tool_version` (no triggers: descriptions come from the version row).
 */
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
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
