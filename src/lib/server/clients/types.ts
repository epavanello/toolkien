/**
 * MCP clients of a user and onboarding progress (owner: onboarding, read-only over the OAuth,
 * connector and audit tables).
 *
 * - A client counts as authorized when the user consented to it, or holds a live (unrevoked,
 *   unexpired) access or refresh token for it. Revoked/expired-only clients are not listed.
 * - `lastUsedAt` is the latest sign of activity: a token issued (refreshes rotate while the
 *   client works) or an audited call made through it. Never token values.
 * - Onboarding steps tick from real data only: a connector visible to the user in the
 *   workspace, an authorized client, a tool call or execution made through a client.
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
	clients: AuthorizedClient[];
	/** A tool call or execution made by the user through an MCP client in this workspace */
	triedPrompt: boolean;
};

/** Whether the post-login landing should send the user to the connect page */
export const needsConnectGuide = (status: Pick<OnboardingStatus, 'connectors' | 'clients'>) =>
	status.connectors.length === 0 && status.clients.length === 0;
