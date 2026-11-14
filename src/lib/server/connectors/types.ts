import type {
	ConnectorAuthType,
	ConnectorScope,
	ConnectorSource,
	ConnectorStatus,
	JsonSchema,
	ToolAnnotations
} from '#lib/server/db/schema/index.ts';
import type { WorkspaceActor } from '#lib/server/workspaces/types.ts';

export type {
	ConnectorAuthType,
	ConnectorScope,
	ConnectorSource,
	ConnectorStatus,
	JsonSchema,
	ToolAnnotations
};

/**
 * Connectors contract (owner: connectors).
 *
 * Invariants:
 * - Only remote MCP servers over Streamable HTTP, `https` only; every outbound request goes
 *   through `#lib/server/net` `safeFetch` (SSRF rules, egress proxy).
 * - Credentials are sealed with `#lib/server/crypto` and decrypted only inside `callTool`
 *   (i.e. on behalf of the bridge), in memory. Tokens never reach logs, errors, the UI or the
 *   MCP client; the client's own Toolkien token is never forwarded upstream (no passthrough).
 * - Upstream OAuth uses PKCE, minimal scopes, automatic refresh; tokens are revoked upstream
 *   when the connector is removed (best effort).
 * - Admin policy (`allowedServers`, `allowPersonalConnectors`, `allowFreeUrls`) is enforced on
 *   add; free URLs are marked `unverified`.
 * - A user sees shared connectors of the workspace plus their own personal ones; tool search and
 *   describe only return tools of connectors the user can see and call, and hide tools that
 *   `#lib/server/permissions` blocks (the bridge still checks the level on every call).
 * - Every definition refresh that changes a tool saves a new `tool_version`; a changed
 *   `signatureHash` sends confirmed permissions back to "to confirm", and changed descriptions
 *   of unverified connectors raise a `connector.descriptions_changed` audit event.
 * - Refresh triggers: upstream `list_changed`, session open with a 6 h cache, call failure
 *   for unknown tool / invalid params, and the UI button.
 */

export type DirectoryEntry = {
	/** Stable slug, stored in `connector.directory_id` */
	id: string;
	name: string;
	description: string;
	url: string;
	authType: ConnectorAuthType;
	homepage?: string;
	/** Suggested namespace in the generated types */
	namespace: string;
	/** Upstream OAuth scopes to request (minimal) */
	scopes?: string[];
	/** Verified annotations that override what the server reports, by upstream tool name */
	annotations?: Record<string, ToolAnnotations>;
	/** (additive) Data-driven fields from `directory/servers/<id>.json` */
	category: string;
	tags: string[];
	/** Reviewer notes per upstream tool name */
	toolNotes: Record<string, string>;
	/** `token` auth: where to create the token, shown next to the input */
	tokenHelp?: string;
	tokenUrl?: string;
	/** OAuth registration the upstream supports (hint; discovery decides) */
	oauthRegistration?: ('cimd' | 'dcr' | 'preregistered')[];
	verification: {
		/** `unverified` entries are treated like free URLs (tools flagged unverified) */
		status: 'verified' | 'community' | 'unverified';
		by: string;
		on: string;
		notes?: string;
	};
};

export type ConnectorSummary = {
	id: string;
	workspaceId: string;
	name: string;
	/** (additive) Instance label (`DevMotion`) when a server is added once per account/project */
	label: string | null;
	/** (additive) `PostHog (DevMotion)`, or the name when there is no label */
	displayName: string;
	namespace: string;
	scope: ConnectorScope;
	ownerUserId: string | null;
	source: ConnectorSource;
	directoryId: string | null;
	url: string;
	unverified: boolean;
	authType: ConnectorAuthType;
	status: ConnectorStatus;
	statusMessage: string | null;
	suspended: boolean;
	/** Whether the viewing user has a usable credential (shared: the admin's one) */
	authenticated: boolean;
	toolCount: number;
	lastSyncedAt: Date | null;
	/** (additive) The actor may edit / remove it (admins; members for their own connectors) */
	canManage: boolean;
	/**
	 * (additive) The actor may (re)authenticate it: shared → admins only; personal → every
	 * member for their own account
	 */
	canAuthenticate: boolean;
	/** (additive) Negotiated MCP version on the last sync */
	protocolVersion: string | null;
};

/** (additive) One tool of a connector, as shown in the connector detail panel */
export type ConnectorTool = {
	id: string;
	path: string;
	upstreamName: string;
	title: string | null;
	/** First line of the description */
	summary: string;
	description: string | null;
	/** `.d.ts` member declaration (typegen) */
	declaration: string;
	annotations: ToolAnnotations | null;
	version: number;
	signatureHash: string;
	/** The description differs from the previous version (tool-poisoning warning) */
	descriptionChanged: boolean;
	/** Reviewer note from the directory entry */
	note: string | null;
	removed: boolean;
	updatedAt: Date;
};

/** (additive) */
export type ConnectorDetail = ConnectorSummary & {
	serverInfo: { name: string; version: string } | null;
	directory: DirectoryEntry | null;
	tools: ConnectorTool[];
};

export type AddConnectorInput = {
	scope: ConnectorScope;
	/** Personal connector only for the acting member (`owner_user_id`) */
	onlyForMe: boolean;
	source: { type: 'directory'; directoryId: string } | { type: 'url'; url: string };
	name?: string;
	authType?: ConnectorAuthType;
	/**
	 * (additive) Instance label: the same server may be added many times (one per account or
	 * project); the namespace is derived from it (`posthog` + `DevMotion` → `posthogDevmotion`)
	 */
	label?: string;
	/** (additive) Explicit namespace (camelCase identifier, unique in the workspace) */
	namespace?: string;
};

/** (additive) Rename an instance: new label and/or namespace; tool paths follow the namespace */
export type RenameConnectorInput = { label?: string | null; namespace?: string; name?: string };

export type SyncReason = 'manual' | 'session' | 'list_changed' | 'call_error' | 'cache_expired';

export type SyncResult = {
	added: number;
	updated: number;
	removed: number;
	/** Tools whose signature changed (their permissions now need confirmation) */
	signatureChanged: string[];
	/** (additive) Tools whose description changed (users are warned: tool poisoning) */
	descriptionChanged: string[];
};

export type ToolSearchHit = {
	path: string;
	/** First line of the description, unverified ones prefixed with "[unverified]" */
	summary: string;
	connectorName: string;
	unverified: boolean;
	/**
	 * (additive, mcp) Namespace of the connector instance (`posthogDevmotion`): a workspace can
	 * hold several instances of the same server (different accounts), one namespace each
	 */
	namespace?: string;
	/** (additive, mcp) Which account/instance this is (label, project, email), shown to the agent */
	accountHint?: string | null;
};

export type ResolvedTool = {
	toolId: string;
	path: string;
	connectorId: string;
	workspaceId: string;
	upstreamName: string;
	signatureHash: string;
	annotations: ToolAnnotations | null;
	source: ConnectorSource;
	unverified: boolean;
	inputSchema: JsonSchema;
	outputSchema: JsonSchema | null;
};

export type ToolDescription = {
	path: string;
	/**
	 * `.d.ts` text (from typegen). Tools of one namespace share one declaration: the first
	 * described tool of a namespace carries it for all of them, the others have `''`.
	 */
	declaration: string;
	/** (additive, mcp) Connector instance the tool belongs to */
	connectorName?: string;
	/**
	 * (additive, mcp) Namespace of the connector instance (`posthogDevmotion`): a workspace can
	 * hold several instances of the same server (different accounts), one namespace each
	 */
	namespace?: string;
	/** (additive, mcp) Which account/instance this is (label, project, email), shown to the agent */
	accountHint?: string | null;
};

export type UpstreamCallResult =
	| { ok: true; structuredContent?: unknown; content: unknown[]; isError?: false }
	| {
			ok: false;
			/** `unknown_tool` / `invalid_params` trigger a refresh; the message has the new signature */
			code: 'unknown_tool' | 'invalid_params' | 'auth_required' | 'upstream_error' | 'timeout';
			message: string;
	  };

export interface ConnectorsService {
	listDirectory(): DirectoryEntry[];
	list(actor: WorkspaceActor): Promise<ConnectorSummary[]>;
	add(actor: WorkspaceActor, input: AddConnectorInput): Promise<ConnectorSummary>;
	/** Deletes configuration and credentials, revoking upstream tokens where possible */
	remove(actor: WorkspaceActor, connectorId: string): Promise<void>;
	/** Starts upstream OAuth (PKCE); returns the URL to send the browser to */
	startOAuth(
		actor: WorkspaceActor,
		connectorId: string,
		returnTo: string
	): Promise<{ authorizationUrl: string }>;
	/**
	 * Upstream OAuth callback: exchanges the code, seals the tokens, triggers a sync.
	 * (additive) `opts.userId` is the signed-in user of the callback request: when given it must
	 * be the user who started the flow (prevents completing someone else's flow); `opts.iss` is
	 * the RFC 9207 `iss` parameter, checked against the discovered issuer.
	 */
	completeOAuth(
		state: string,
		code: string,
		opts?: { userId?: string; iss?: string }
	): Promise<{ workspaceId: string; connectorId: string; returnTo: string }>;
	/** Stores a pasted token / API key (sealed) */
	setToken(actor: WorkspaceActor, connectorId: string, token: string): Promise<void>;
	syncTools(actor: WorkspaceActor, connectorId: string, reason: SyncReason): Promise<SyncResult>;
	/** (additive) One connector with its tools; 404 when the actor cannot see it */
	get(actor: WorkspaceActor, connectorId: string): Promise<ConnectorDetail>;
	/**
	 * (additive) Renames an instance (label, display name, namespace). A namespace change moves
	 * every tool path (`posthog.query` → `posthogDevmotion.query`); permissions are keyed by
	 * tool id and survive. 409 when the namespace is taken.
	 */
	rename(
		actor: WorkspaceActor,
		connectorId: string,
		input: RenameConnectorInput
	): Promise<ConnectorSummary>;
	/** (additive) Removes the actor's own credential (or the shared one, admins), revoking it */
	disconnect(actor: WorkspaceActor, connectorId: string): Promise<void>;
	/**
	 * (additive) Revokes upstream (best effort) and deletes every credential `userId` holds on
	 * connectors of the workspace (member leaving or removed, account deletion). Returns the
	 * number of credentials deleted. No permission check: callers authorise the removal.
	 */
	revokeUserCredentials(workspaceId: string, userId: string): Promise<number>;
	/**
	 * (additive) Session open: syncs the actor's usable connectors whose definitions are older
	 * than 6 h (or never synced). Never throws; failures land in the connector status.
	 */
	refreshStale(actor: WorkspaceActor): Promise<void>;
	/**
	 * Keyword search over the tools the actor can see and call (connector visible, credential
	 * usable, not suspended) minus the tools `permissions.visibleToolIds` hides (blocked). Every
	 * query word must match; exact names rank first, then name prefixes, names, instances
	 * (namespace, connector name, label) and descriptions.
	 */
	searchTools(actor: WorkspaceActor, query: string, limit?: number): Promise<ToolSearchHit[]>;
	/** Same visibility as `searchTools`; unknown or blocked paths are omitted */
	describeTools(actor: WorkspaceActor, paths: string[]): Promise<ToolDescription[]>;
	/**
	 * `.d.ts` of every tool the actor may call (input to the runner type-check). An empty
	 * `toolIds` means every callable tool.
	 */
	declarationsFor(actor: WorkspaceActor, toolIds: string[]): Promise<string>;
	resolveTool(actor: WorkspaceActor, path: string): Promise<ResolvedTool | null>;
	/**
	 * Calls the upstream tool with the right credential (shared or the actor's own).
	 * Bridge-only: callers must have checked permissions and approvals first.
	 */
	callTool(actor: WorkspaceActor, tool: ResolvedTool, args: unknown): Promise<UpstreamCallResult>;
}
