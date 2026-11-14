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
 * - Owners and admins of company workspaces must have a passkey before admin actions.
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

// ─── Org-ops extensions (additive) ──────────────────────────────────────────

/** Days between the owner's deletion request and the hard delete (purge job) */
export const DELETION_GRACE_DAYS = 7;

/** Roles an invite link or a role change may grant (`owner` only via transfer) */
export type GrantableRole = Exclude<WorkspaceRole, 'owner'>;

export type MemberSummary = {
	userId: string;
	/** `member` row id: opaque, used in audit metadata instead of the user id */
	memberId: string;
	name: string;
	email: string;
	role: WorkspaceRole;
	joinedAt: Date;
	/** At least one passkey registered; `null` when the viewer is not an admin */
	secondFactor: boolean | null;
};

export type InviteLinkStatus = 'active' | 'expired' | 'revoked' | 'used';

export type InviteLinkSummary = {
	id: string;
	role: GrantableRole;
	email: string | null;
	maxUses: number | null;
	useCount: number;
	expiresAt: Date;
	createdAt: Date;
	createdByName: string | null;
	status: InviteLinkStatus;
};

export type CreateInviteInput = {
	role: GrantableRole;
	/** Only this email may accept (case-insensitive) */
	email?: string | null;
	maxUses?: number | null;
	/** 1–30, default 7 */
	expiresInDays?: number;
};

/** What the invite page shows before accepting; never reveals more than name and role */
export type InvitePreview =
	| { status: 'invalid' }
	| {
			status: Exclude<InviteLinkStatus, 'used'> | 'used' | 'email_mismatch' | 'already_member';
			workspaceName: string;
			workspaceSlug: string;
			role: GrantableRole;
	  };

export type PolicyInput = Omit<WorkspacePolicy, 'workspaceId'>;

/** Result of checking a connector addition against the admin policy (pure, see `checkConnectorPolicy`) */
export type PolicyCheck = { allowed: true } | { allowed: false; reason: string };

export type ConnectorPolicyInput = {
	/** Workspace-wide (admin) connector vs one only for the acting member */
	onlyForMe: boolean;
	source: { type: 'directory'; directoryId: string } | { type: 'url'; url: string };
};

/** Owner-only deletion state of a company workspace */
export type DeletionState = { scheduledAt: Date; purgeAt: Date } | null;
