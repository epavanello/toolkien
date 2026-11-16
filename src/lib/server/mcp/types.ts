/**
 * MCP server contract (owner: mcp).
 *
 * - One remote MCP server at `${ORIGIN}/mcp`, Streamable HTTP, protocol 2026-07-28 with
 *   version negotiation (2025-11-25 accepted). Stateless: no `Mcp-Session-Id`, no GET stream.
 * - Bearer tokens only (issued by Better Auth `mcp()`): audience = `${ORIGIN}/mcp`, PKCE S256,
 *   15-minute access tokens. Cookies are ignored on `/mcp` (the hooks skip session lookup).
 * - Exactly these tools are exposed; there is NO approve tool. Descriptions teach the flow:
 *   search → describe → execute.
 * - Every `tools_search` and `execute` result names the active workspace.
 * - `workspace_switch` requires human confirmation (elicitation, or a confirmation link) and
 *   records `workspace.switched`.
 * - Elicitation is used only when the client declared the capability; otherwise the out-of-band
 *   approval page is returned.
 */
export const MCP_TOOL_NAMES = [
	'workspace_list',
	'workspace_switch',
	'tools_search',
	'tools_describe',
	'execute',
	'execution_status'
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export const MCP_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25'] as const;
export type McpProtocolVersion = (typeof MCP_PROTOCOL_VERSIONS)[number];

/** Verified access-token identity of one MCP request */
export type McpRequestContext = {
	userId: string;
	/** OAuth `client_id` (CIMD URL or registered id) */
	clientId: string;
	/** OAuth registration `client_name` (self-asserted; display only) */
	clientName: string | null;
	/** MCP `clientInfo` as `name version` (self-asserted; display only), when known */
	clientInfo?: string | null;
	scopes: string[];
	/** Client IP (per-IP execution rate limit); absent in tests */
	clientAddress?: string;
};

export type McpClientCapabilities = {
	elicitation: { form: boolean; url: boolean };
};

/** Handles one HTTP request to `/mcp` after the bearer token was verified */
export type HandleMcpRequest = (request: Request, ctx: McpRequestContext) => Promise<Response>;

/**
 * A workspace switch asked by an MCP client, whatever the channel: the human settles it in the
 * client dialog or on the Toolkien consent page (`/consent?switch=<id>`, also listed on the
 * workspace "Pending approvals" page). Held in memory (single instance, short-lived), expires
 * after `SWITCH_REQUEST_TTL_MS`.
 */
export type PendingWorkspaceSwitch = {
	id: string;
	userId: string;
	clientId: string;
	clientName: string | null;
	clientInfo?: string | null;
	fromWorkspaceId: string;
	toWorkspaceId: string;
	status: 'pending' | 'confirmed' | 'rejected';
	expiresAt: Date;
};

/** A pending workspace switch as the "Pending approvals" page lists it */
export type PendingSwitchRow = {
	id: string;
	client: string;
	from: string;
	to: string;
	expiresAt: Date;
};

export const SWITCH_REQUEST_TTL_MS = 10 * 60 * 1000;
