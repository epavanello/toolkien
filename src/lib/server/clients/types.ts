import type { WorkspaceKind } from '#lib/server/db/schema/index.ts';

/**
 * MCP clients of a user and onboarding progress (owner: onboarding; reads the OAuth, connector
 * and audit tables, writes only to name, move or revoke a connection).
 *
 * - (changed) The unit is the MCP connection (`mcp_connection`): one per "Allow access" on the
 *   consent screen, not one per OAuth client. Its id is the consent `reference_id`, carried by
 *   the code and every refresh token of the grant and stamped on access tokens
 *   (`connection_id` claim), so `/mcp` knows which connection each request comes from. Two
 *   sign-ins of the same client (two Claude accounts share Claude's CIMD `client_id`) with the
 *   same Toolkien user are two connections, each with its own name, workspace and disconnect.
 * - A connection counts as authorized while its consent stands and its grant does: a live
 *   (unrevoked, unexpired) refresh token, or none issued yet. When every refresh token is gone
 *   the client signs in again, which makes a new connection.
 * - `lastUsedAt` is the latest sign of activity: a refresh token issued (they rotate while the
 *   client works) or an audited call made through the connection (not what the user did to it
 *   from the app: moves, renames, disconnects). Never token values.
 * - (additive) Disconnecting deletes, for that connection only, its consent, its access and
 *   refresh tokens and the connection, in one transaction, and records `mcp_client.revoked`.
 *   Access tokens are JWTs verified offline, so `/mcp` also requires a live grant
 *   (`hasLiveGrant`): a token issued before the disconnect stops working at once.
 * - (additive) The MCP `clientInfo` a client sent in `initialize` (`name version`) is kept on
 *   the connection (`rememberClientInfo`) to label its later stateless requests in the
 *   activity. Self-asserted, display only.
 * - (additive) The user names each connection (`setClientLabel`): asked on the consent screen
 *   (starting from the registered name, never from another connection's), editable from
 *   Connected clients. It replaces the registered name everywhere the connection is shown
 *   (list, activity, approvals, switch requests). Events recorded through the connection show
 *   its current name; a name equal to the registered one, or empty, clears it. Renames are
 *   audited.
 * - (additive) Each connection works in its own workspace (chosen on the consent screen,
 *   switched by `workspace_switch` after confirmation). The list shows it, and the user can move
 *   a connection from here (`moveClient`): the user acting in the app is the confirmation;
 *   audited as `workspace.switched` (channel `settings`) in the target workspace.
 * - Onboarding steps tick from real data only: a connector visible to the user in the
 *   workspace, an authorized client, a tool call made through a client: (changed) any audited
 *   MCP tool call counts (`tools_search`, `tools_describe`, `execute`), so the step ticks as soon
 *   as an agent reaches Toolkien, not only after a script ran.
 */
export type AuthorizedClient = {
	/** (additive) The connection (`mcp_connection.id`): what Rename, Move and Disconnect act on */
	connectionId: string;
	clientId: string;
	/** The user's name for it, else the registered name (self-asserted for DCR clients) */
	name: string;
	/** (additive) The OAuth registration name, `null` when it has none */
	registeredName: string | null;
	/**
	 * (additive) The workspace the connection works in (`mcp_connection.workspace_id`, else the
	 * personal one): each connection has its own, switched without touching the others
	 */
	workspace: ClientWorkspace | null;
	connectedAt: Date;
	lastUsedAt: Date | null;
};

export type OnboardingStatus = {
	/** `${ORIGIN}/mcp` */
	mcpUrl: string;
	/** Names of connectors the user can see in the workspace (for sample prompts) */
	connectors: string[];
	/** (additive) The same services with their logo, for display */
	servers: OnboardingServer[];
	clients: AuthorizedClient[];
	/** (additive) The user's workspaces, where a client can be moved */
	workspaces: ClientWorkspace[];
	/** A tool call or execution made by the user through an MCP client in this workspace */
	triedPrompt: boolean;
	/** (additive) The first of those calls, for the "first call arrived" state */
	firstCall: FirstToolCall | null;
};

/** (additive) A workspace as the client list shows it */
export type ClientWorkspace = {
	id: string;
	slug: string;
	name: string;
	kind: WorkspaceKind;
};

/** (additive) A service the user can use in the workspace (`ConnectorSummary.icon` for `icon`) */
export type OnboardingServer = { name: string; icon: string | null };

/** (additive) The user's first MCP tool call in a workspace */
export type FirstToolCall = {
	/** `tools_search`, `tools_describe`, `execute`, or the upstream tool path (`github.listIssues`) */
	tool: string;
	/** MCP client display name, when the client gave one */
	clientName: string | null;
	at: Date;
};

/** Whether the post-login landing should send the user to the connect page */
export const needsConnectGuide = (status: Pick<OnboardingStatus, 'connectors' | 'clients'>) =>
	status.connectors.length === 0 && status.clients.length === 0;

/** (additive) What a disconnect removed (counts only) */
export type RevokedClient = {
	connectionId: string;
	clientId: string;
	name: string;
	accessTokens: number;
	refreshTokens: number;
	consents: number;
};

/** (additive) Longest client name a user can give */
export const CLIENT_LABEL_MAX = 60;

/** A user-given client name: single line, printable, capped; `null` when nothing is left */
export function cleanClientLabel(value: string | null | undefined): string | null {
	// eslint-disable-next-line no-control-regex
	const line = (value ?? '').replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\s]+/g, ' ').trim();
	if (!line) return null;
	return line.length > CLIENT_LABEL_MAX ? line.slice(0, CLIENT_LABEL_MAX).trimEnd() : line;
}
