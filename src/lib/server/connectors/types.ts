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
 *   describe only return tools of connectors the user can see. Filtering by permission level
 *   (blocked tools hidden) is done by the caller with `#lib/server/permissions`.
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
};

export type ConnectorSummary = {
	id: string;
	workspaceId: string;
	name: string;
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
};

export type AddConnectorInput = {
	scope: ConnectorScope;
	/** Personal connector only for the acting member (`owner_user_id`) */
	onlyForMe: boolean;
	source: { type: 'directory'; directoryId: string } | { type: 'url'; url: string };
	name?: string;
	authType?: ConnectorAuthType;
};

export type SyncReason = 'manual' | 'session' | 'list_changed' | 'call_error' | 'cache_expired';

export type SyncResult = {
	added: number;
	updated: number;
	removed: number;
	/** Tools whose signature changed (their permissions now need confirmation) */
	signatureChanged: string[];
};

export type ToolSearchHit = {
	path: string;
	/** First line of the description, unverified ones prefixed with "[unverified]" */
	summary: string;
	connectorName: string;
	unverified: boolean;
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
	/** `.d.ts` text for this tool (from typegen) */
	declaration: string;
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
	/** Upstream OAuth callback: exchanges the code, seals the tokens, triggers a sync */
	completeOAuth(
		state: string,
		code: string
	): Promise<{ workspaceId: string; connectorId: string; returnTo: string }>;
	/** Stores a pasted token / API key (sealed) */
	setToken(actor: WorkspaceActor, connectorId: string, token: string): Promise<void>;
	syncTools(actor: WorkspaceActor, connectorId: string, reason: SyncReason): Promise<SyncResult>;
	/** FTS5 search over the tools the actor can see */
	searchTools(actor: WorkspaceActor, query: string, limit?: number): Promise<ToolSearchHit[]>;
	describeTools(actor: WorkspaceActor, paths: string[]): Promise<ToolDescription[]>;
	/** `.d.ts` of every tool the actor may call (input to the runner type-check) */
	declarationsFor(actor: WorkspaceActor, toolIds: string[]): Promise<string>;
	resolveTool(actor: WorkspaceActor, path: string): Promise<ResolvedTool | null>;
	/**
	 * Calls the upstream tool with the right credential (shared or the actor's own).
	 * Bridge-only: callers must have checked permissions and approvals first.
	 */
	callTool(actor: WorkspaceActor, tool: ResolvedTool, args: unknown): Promise<UpstreamCallResult>;
}
