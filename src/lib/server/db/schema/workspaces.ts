/**
 * Workspaces. A workspace IS a Better Auth organization (`organization`, `member`,
 * `invitation` live in `auth.ts`, generated); its extra columns (`kind`, `deleteScheduledAt`,
 * `suspendedAt`) are declared as `additionalFields` in `#lib/server/auth.ts`. This file holds
 * what Better Auth does not model: policy, link invites, MCP connections and the workspace
 * data key.
 */
import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { organization, user } from './auth.ts';
import { createdAt, id, json, timestamp, updatedAt } from './columns.ts';

export const WORKSPACE_KINDS = ['personal', 'company'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const WORKSPACE_ROLES = ['owner', 'admin', 'member'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

export const PERMISSION_LEVELS = ['allow', 'ask', 'block'] as const;
/** `allow` = always allowed, `ask` = ask for confirmation, `block` = blocked */
export type PermissionLevel = (typeof PERMISSION_LEVELS)[number];

/**
 * Admin policy, one row per workspace (created with the workspace; missing row = defaults).
 * Policies only ever restrict: a member can tighten, never loosen.
 */
export const workspacePolicy = sqliteTable('workspace_policy', {
	workspaceId: text('workspace_id')
		.primaryKey()
		.references(() => organization.id, { onDelete: 'cascade' }),
	/**
	 * Directory server ids and URL origins (`https://mcp.example.com`) members may connect.
	 * `null` = any server; `[]` = none.
	 */
	allowedServers: json<string[] | null>('allowed_servers'),
	/** Members may add connectors that only they use */
	allowPersonalConnectors: integer('allow_personal_connectors', { mode: 'boolean' })
		.notNull()
		.default(true),
	/** Connectors from free URLs (outside the curated directory, marked "unverified") */
	allowFreeUrls: integer('allow_free_urls', { mode: 'boolean' }).notNull().default(true),
	/**
	 * Floor applied to every tool in the workspace (`null` = none). Per-tool floors are
	 * `permission_level` rows with `user_id IS NULL`.
	 */
	permissionFloor: text('permission_floor', { enum: PERMISSION_LEVELS }),
	updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
	updatedAt: updatedAt()
});

/**
 * Invite links (there is no email service). The raw token only exists in the link shown once
 * to the admin; the table stores its SHA-256. Accepting adds a `member` row with `role`.
 */
export const workspaceInviteLink = sqliteTable(
	'workspace_invite_link',
	{
		id: id(),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		tokenHash: text('token_hash').notNull().unique(),
		role: text('role', { enum: WORKSPACE_ROLES }).notNull().default('member'),
		/** Optional: only this email may accept */
		email: text('email'),
		maxUses: integer('max_uses'),
		useCount: integer('use_count').notNull().default(0),
		expiresAt: timestamp('expires_at').notNull(),
		revokedAt: timestamp('revoked_at'),
		createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
		createdAt: createdAt()
	},
	(t) => [index('workspace_invite_link_workspace_idx').on(t.workspaceId)]
);

/**
 * One MCP connection: what a single "Allow access" on the consent screen created. Its id is the
 * OAuth consent `reference_id`, which the provider stores on the consent, the authorization code
 * and every refresh token of the grant (rotation carries it over), and which we stamp on every
 * access token (`connection_id` claim). So two clients sharing one `client_id` (every Claude
 * account uses the same CIMD URL) with the same Toolkien user stay two connections, each with
 * its own name, workspace and disconnect.
 */
export const mcpConnection = sqliteTable(
	'mcp_connection',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => user.id, { onDelete: 'cascade' }),
		/** OAuth `client_id` of the MCP client (CIMD URL or registered id) */
		clientId: text('client_id').notNull(),
		/**
		 * The name the user gave it ("Work laptop", "Claude — Emanuele"): asked on the consent
		 * screen, editable from Connected clients. Sanitized, single-line, length-capped; `null`
		 * shows the registered name. Display only.
		 */
		label: text('label'),
		/**
		 * The MCP `clientInfo` (`name version`, e.g. `claude-code 2.1.3`) sent in the last
		 * `initialize`: 2025-era clients send it once, later stateless requests are labelled with
		 * it in the audit. Self-asserted, display only.
		 */
		clientInfo: text('client_info'),
		/**
		 * The workspace it works in, chosen on the consent screen and switched only after human
		 * confirmation; `null` (or a workspace the user left) means the personal one.
		 */
		workspaceId: text('workspace_id').references(() => organization.id, {
			onDelete: 'set null'
		}),
		createdAt: createdAt(),
		updatedAt: updatedAt()
	},
	(t) => [index('mcp_connection_user_idx').on(t.userId, t.clientId)]
);

/**
 * Envelope encryption: one data key (DEK) per workspace and version, wrapped by the OpenBao
 * transit key derived with the workspace id as context. The plaintext DEK never touches the
 * database. Exactly one `active` version per workspace; `retired` versions stay until every
 * sealed value has been rewrapped.
 */
export const workspaceDataKey = sqliteTable(
	'workspace_data_key',
	{
		id: id(),
		workspaceId: text('workspace_id')
			.notNull()
			.references(() => organization.id, { onDelete: 'cascade' }),
		keyVersion: integer('key_version').notNull(),
		/** Transit ciphertext (`vault:vN:…`), or `static:…` / `dev:…` with a local master key */
		wrappedKey: text('wrapped_key').notNull(),
		status: text('status', { enum: ['active', 'retired'] })
			.notNull()
			.default('active'),
		createdAt: createdAt()
	},
	(t) => [
		uniqueIndex('workspace_data_key_version_uq').on(t.workspaceId, t.keyVersion),
		uniqueIndex('workspace_data_key_active_uq')
			.on(t.workspaceId)
			.where(sql`status = 'active'`)
	]
);
