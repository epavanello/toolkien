import type { PermissionLevel, WorkspaceKind, WorkspaceRole } from '#lib/server/db/schema/index.ts';

export type { PermissionLevel, WorkspaceKind, WorkspaceRole };

/**
 * Workspaces contract (owner: org-ops). A workspace is a Better Auth organization.
 *
 * Invariants:
 * - Every user has exactly one personal workspace (`kind = 'personal'`, they are its owner).
 * - Every server-side read or write of workspace data is scoped by `workspaceId` AND checks
 *   membership of the acting user; a slug in a URL is never trusted on its own.
 * - Roles: owner > admin > member. Only the owner deletes (7-day grace) or transfers ownership.
 * - Owners and admins of company workspaces must have 2FA or a passkey before admin actions.
 * - Suspended workspaces (`suspendedAt`) or workspaces scheduled for deletion cannot start
 *   executions; their connectors stay configured.
 */

/** The acting user inside one workspace: the argument of almost every service call */
export type WorkspaceActor = {
	workspaceId: string;
	userId: string;
	role: WorkspaceRole;
};

export type WorkspaceSummary = {
	id: string;
	slug: string;
	name: string;
	kind: WorkspaceKind;
	/** Role of the user the summary was loaded for */
	role: WorkspaceRole;
	suspended: boolean;
	deleteScheduledAt: Date | null;
};

export type WorkspacePolicy = {
	workspaceId: string;
	/** `null` = every server allowed */
	allowedServers: string[] | null;
	allowPersonalConnectors: boolean;
	allowFreeUrls: boolean;
	permissionFloor: PermissionLevel | null;
};

export interface WorkspacesService {
	/** Workspaces the user belongs to, personal first then by name */
	listForUser(userId: string): Promise<WorkspaceSummary[]>;
	/** Membership lookup by URL slug; `null` when the user is not a member */
	getBySlug(userId: string, slug: string): Promise<WorkspaceSummary | null>;
	getById(userId: string, workspaceId: string): Promise<WorkspaceSummary | null>;
	/**
	 * Active workspace for an MCP client: the stored choice, else the personal workspace.
	 * Falls back to personal if the user lost access to the stored one.
	 */
	getActiveWorkspace(userId: string, clientId: string): Promise<WorkspaceSummary>;
	/**
	 * Stores the active workspace. Callers MUST have obtained explicit human confirmation
	 * (elicitation or consent screen) and record a `workspace.switched` audit event.
	 */
	setActiveWorkspace(userId: string, clientId: string, workspaceId: string): Promise<void>;
	getPolicy(workspaceId: string): Promise<WorkspacePolicy>;
}
