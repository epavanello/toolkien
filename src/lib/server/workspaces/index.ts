/**
 * Workspaces public API (owner: org-ops). See `types.ts` for the contract and invariants.
 * Admin actions check role AND, for company workspaces, the actor's second factor
 * (`assertAdminAction`); role grants check the target's second factor.
 */
export type * from './types.ts';
export { DELETION_GRACE_DAYS } from './types.ts';

export {
	assertAdminAction,
	assertCompanyAdminAction,
	getById,
	getBySlug,
	hasRole,
	hasSecondFactor,
	listForUser,
	requiresSecondFactor
} from './core.ts';
export { getActiveWorkspace, setActiveWorkspace } from './active.ts';
export { changeRole, listMembers, removeMember, transferOwnership } from './members.ts';
export {
	acceptInvite,
	createInviteLink,
	getInvitePreview,
	inviteStatus,
	listInviteLinks,
	revokeInviteLink
} from './invites.ts';
export {
	checkConnectorPolicy,
	DEFAULT_POLICY,
	getPolicy,
	isServerAllowed,
	normalizeAllowedServers,
	updatePolicy
} from './policy.ts';
export {
	cancelDeletion,
	createWorkspace,
	deleteWorkspaceNow,
	deletionDueAt,
	deletionState,
	purgeScheduledDeletions,
	renameWorkspace,
	scheduleDeletion
} from './lifecycle.ts';
export { removeMemberConnectors } from './members.ts';
