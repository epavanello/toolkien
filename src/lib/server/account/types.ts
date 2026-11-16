import type { WorkspaceRole } from '#lib/server/workspaces/types.ts';

/**
 * Account contract (owner: org-ops): data export and account deletion.
 *
 * - The export holds what Toolkien stores about the user, as metadata: never upstream tokens,
 *   secrets, script code, tool arguments or results (Toolkien does not keep them).
 * - Deletion is refused while the user owns a company workspace with other members (they
 *   transfer ownership or delete it first). Otherwise: workspaces they solely own are deleted
 *   at once (upstream tokens revoked where possible through the connectors contract), their own
 *   connectors and credentials elsewhere are removed, audit events are anonymised (user ids →
 *   NULL) in workspaces that remain and deleted with the workspaces that go, then the user row
 *   and everything cascading from it (sessions, passkeys, MCP tokens, memberships).
 */
export type AccountExport = {
	format: 'toolkien-account-export';
	version: 1;
	exportedAt: string;
	account: {
		id: string;
		name: string;
		email: string;
		createdAt: string;
	};
	passkeys: { name: string | null; deviceType: string; createdAt: string | null }[];
	sessions: {
		createdAt: string;
		expiresAt: string;
		ipAddress: string | null;
		userAgent: string | null;
	}[];
	workspaces: {
		id: string;
		name: string;
		slug: string;
		kind: string;
		role: WorkspaceRole;
		joinedAt: string;
	}[];
	connectors: {
		id: string;
		workspaceId: string;
		name: string;
		url: string;
		scope: string;
		source: string;
		createdAt: string;
	}[];
	/** Which connectors hold a credential of the user (never the credential itself) */
	credentials: {
		connectorId: string;
		workspaceId: string;
		kind: string;
		scope: string | null;
		createdAt: string;
	}[];
	permissions: { workspaceId: string; toolId: string; level: string; updatedAt: string }[];
	/** (changed) One per MCP connection (each approval), not per OAuth client */
	mcpClients: {
		connectionId: string;
		clientId: string;
		name: string | null;
		consentedAt: string;
	}[];
	activeWorkspaces: { connectionId: string; clientId: string; workspaceId: string }[];
	auditEvents: Record<string, unknown>[];
};

export type DeletionBlocker = { workspaceId: string; name: string; slug: string; members: number };
