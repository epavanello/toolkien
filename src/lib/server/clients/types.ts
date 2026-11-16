/**
 * MCP clients of a user and onboarding progress (owner: onboarding; reads the OAuth, connector
 * and audit tables, writes only to revoke a client).
 *
 * - A client counts as authorized when the user consented to it, or holds a live (unrevoked,
 *   unexpired) access or refresh token for it. Revoked/expired-only clients are not listed.
 * - `lastUsedAt` is the latest sign of activity: a token issued (refreshes rotate while the
 *   client works) or an audited call made through it. Never token values.
 * - (additive) Disconnecting a client deletes, for that user and client only, the consent and
 *   every access and refresh token, in one transaction, and records `mcp_client.revoked`. Access
 *   tokens are JWTs verified offline, so `/mcp` also requires a live grant (`hasLiveGrant`):
 *   a token issued before the disconnect stops working at once, not when it expires.
 * - (additive) The MCP `clientInfo` a client sent in `initialize` (`name version`) is kept per
 *   user and client (`rememberClientInfo`) to label its later stateless requests in the
 *   activity; it goes with the client on disconnect. Self-asserted, display only.
 * - Onboarding steps tick from real data only: a connector visible to the user in the
 *   workspace, an authorized client, a tool call made through a client: (changed) any audited
 *   MCP tool call counts (`tools_search`, `tools_describe`, `execute`), so the step ticks as soon
 *   as an agent reaches Toolkien, not only after a script ran.
 */
export type AuthorizedClient = {
	clientId: string;
	/** Self-asserted for dynamically registered clients */
	name: string;
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
	/** A tool call or execution made by the user through an MCP client in this workspace */
	triedPrompt: boolean;
	/** (additive) The first of those calls, for the "first call arrived" state */
	firstCall: FirstToolCall | null;
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
	clientId: string;
	name: string;
	accessTokens: number;
	refreshTokens: number;
	consents: number;
};
