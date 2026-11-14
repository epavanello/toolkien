import { error } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { member, organization, passkey, user } from '#lib/server/db/schema/index.ts';
import type {
	WorkspaceActor,
	WorkspaceRole,
	WorkspaceSummary,
	WorkspacesService
} from './types.ts';

export const ROLE_RANK: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 };

/** Whether `role` is at least `minimum` (owner > admin > member) */
export const hasRole = (role: WorkspaceRole, minimum: WorkspaceRole) =>
	ROLE_RANK[role] >= ROLE_RANK[minimum];

/** 2FA or passkey is required for owners and admins of company workspaces */
export const requiresSecondFactor = (workspace: Pick<WorkspaceSummary, 'kind' | 'role'>) =>
	workspace.kind === 'company' && hasRole(workspace.role, 'admin');

export const toRole = (role: string): WorkspaceRole =>
	role in ROLE_RANK ? (role as WorkspaceRole) : 'member';

const summaryColumns = {
	id: organization.id,
	slug: organization.slug,
	name: organization.name,
	kind: organization.kind,
	role: member.role,
	suspendedAt: organization.suspendedAt,
	deleteScheduledAt: organization.deleteScheduledAt
};

type SummaryRow = {
	id: string;
	slug: string;
	name: string;
	kind: string;
	role: string;
	suspendedAt: Date | null;
	deleteScheduledAt: Date | null;
};

const toSummary = ({ suspendedAt, ...row }: SummaryRow): WorkspaceSummary => ({
	...row,
	kind: row.kind === 'personal' ? 'personal' : 'company',
	role: toRole(row.role),
	suspended: suspendedAt !== null
});

const memberships = (userId: string) =>
	db
		.select(summaryColumns)
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(eq(member.userId, userId));

export const listForUser: WorkspacesService['listForUser'] = async (userId) => {
	const rows = await memberships(userId).orderBy(asc(organization.name));
	return rows
		.map(toSummary)
		.sort((a, b) => Number(b.kind === 'personal') - Number(a.kind === 'personal'));
};

export const getBySlug: WorkspacesService['getBySlug'] = async (userId, slug) => {
	const [row] = await db
		.select(summaryColumns)
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(and(eq(member.userId, userId), eq(organization.slug, slug)))
		.limit(1);
	return row ? toSummary(row) : null;
};

export const getById: WorkspacesService['getById'] = async (userId, workspaceId) => {
	const [row] = await db
		.select(summaryColumns)
		.from(member)
		.innerJoin(organization, eq(organization.id, member.organizationId))
		.where(and(eq(member.userId, userId), eq(organization.id, workspaceId)))
		.limit(1);
	return row ? toSummary(row) : null;
};

/** The workspace an actor acts in; 404 if it vanished (deleted meanwhile) */
export async function loadWorkspace(actor: WorkspaceActor) {
	const summary = await getById(actor.userId, actor.workspaceId);
	if (!summary) error(404, 'Workspace not found.', { code: 'NOT_FOUND' });
	return summary;
}

/** 2FA (verified TOTP) or at least one passkey */
export async function hasSecondFactor(userId: string): Promise<boolean> {
	const [row] = await db
		.select({ twoFactorEnabled: user.twoFactorEnabled })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);
	if (row?.twoFactorEnabled) return true;
	const [key] = await db
		.select({ id: passkey.id })
		.from(passkey)
		.where(eq(passkey.userId, userId))
		.limit(1);
	return !!key;
}

export const secondFactorError = (message: string): never =>
	error(403, message, { code: 'SECOND_FACTOR_REQUIRED' });

/**
 * Throws unless the actor has at least `minRole` and, for owners/admins of a company workspace,
 * a second factor. Every admin action calls it (role grants, policy, deletion, kill switch,
 * workspace-wide logs), so an admin who later removes their 2FA loses admin powers until they
 * add one again.
 */
export async function assertAdminAction(actor: WorkspaceActor, minRole: WorkspaceRole = 'admin') {
	const workspace = await loadWorkspace(actor);
	if (!hasRole(workspace.role, minRole)) {
		error(403, 'You do not have access to this action.', { code: 'FORBIDDEN' });
	}
	if (requiresSecondFactor(workspace) && !(await hasSecondFactor(actor.userId))) {
		secondFactorError(
			'Add a passkey or enable two-factor authentication to manage this workspace.'
		);
	}
	return workspace;
}

/** Like `assertAdminAction`, for actions that only make sense in company workspaces */
export async function assertCompanyAdminAction(
	actor: WorkspaceActor,
	minRole: WorkspaceRole = 'admin'
) {
	const workspace = await assertAdminAction(actor, minRole);
	if (workspace.kind !== 'company') {
		error(400, 'Personal workspaces have a single member.', { code: 'INVALID_INPUT' });
	}
	return workspace;
}
