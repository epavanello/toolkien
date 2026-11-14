import { and, asc, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { member, organization } from '#lib/server/db/schema/index.ts';
import { notImplemented } from '#lib/server/not-implemented.ts';
import type { WorkspaceRole, WorkspaceSummary, WorkspacesService } from './types.ts';

export type * from './types.ts';

const ROLE_RANK: Record<WorkspaceRole, number> = { member: 0, admin: 1, owner: 2 };

/** Whether `role` is at least `minimum` (owner > admin > member) */
export const hasRole = (role: WorkspaceRole, minimum: WorkspaceRole) =>
	ROLE_RANK[role] >= ROLE_RANK[minimum];

/** 2FA or passkey is required for owners and admins of company workspaces */
export const requiresSecondFactor = (workspace: Pick<WorkspaceSummary, 'kind' | 'role'>) =>
	workspace.kind === 'company' && hasRole(workspace.role, 'admin');

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
	role: (row.role in ROLE_RANK ? row.role : 'member') as WorkspaceRole,
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

export const getActiveWorkspace: WorkspacesService['getActiveWorkspace'] = async () =>
	notImplemented('workspaces.getActiveWorkspace');
export const setActiveWorkspace: WorkspacesService['setActiveWorkspace'] = async () =>
	notImplemented('workspaces.setActiveWorkspace');
export const getPolicy: WorkspacesService['getPolicy'] = async () =>
	notImplemented('workspaces.getPolicy');
