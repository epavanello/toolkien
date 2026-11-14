import { ORIGIN } from '$app/env/private';
import { error } from '@sveltejs/kit';
import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import { member, organization, user, workspaceInviteLink } from '#lib/server/db/schema/index.ts';
import { assertCompanyAdminAction, hasSecondFactor, secondFactorError } from './core.ts';
import type {
	CreateInviteInput,
	GrantableRole,
	InviteLinkStatus,
	InviteLinkSummary,
	InvitePreview,
	WorkspaceActor
} from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
export const INVITE_MAX_DAYS = 30;

/** 32 random bytes, base64url: the only copy lives in the link shown once */
export function generateInviteToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Buffer.from(bytes).toString('base64url');
}

export async function hashInviteToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	return Buffer.from(digest).toString('hex');
}

export const inviteUrl = (token: string) => `${ORIGIN}/invite/${token}`;

type InviteRow = Pick<
	typeof workspaceInviteLink.$inferSelect,
	'expiresAt' | 'revokedAt' | 'maxUses' | 'useCount'
>;

/** Pure: status of an invite link at `now` */
export function inviteStatus(row: InviteRow, now = new Date()): InviteLinkStatus {
	if (row.revokedAt) return 'revoked';
	if (row.maxUses != null && row.useCount >= row.maxUses) return 'used';
	if (row.expiresAt.getTime() <= now.getTime()) return 'expired';
	return 'active';
}

/**
 * Creates an invite link (admins of company workspaces). Returns the raw token once: only its
 * SHA-256 is stored.
 */
export async function createInviteLink(
	actor: WorkspaceActor,
	input: CreateInviteInput
): Promise<{ invite: InviteLinkSummary; token: string; url: string }> {
	await assertCompanyAdminAction(actor);
	const days = Math.min(Math.max(Math.trunc(input.expiresInDays ?? 7), 1), INVITE_MAX_DAYS);
	const maxUses = input.maxUses && input.maxUses > 0 ? Math.trunc(input.maxUses) : null;
	const email = input.email?.trim().toLowerCase() || null;
	const token = generateInviteToken();
	const [row] = await db
		.insert(workspaceInviteLink)
		.values({
			workspaceId: actor.workspaceId,
			tokenHash: await hashInviteToken(token),
			role: input.role,
			email,
			maxUses,
			expiresAt: new Date(Date.now() + days * DAY_MS),
			createdBy: actor.userId
		})
		.returning();
	await record({
		type: 'member.invited',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		metadata: { inviteId: row.id, role: input.role, restrictedToEmail: !!email, maxUses, days }
	});
	return {
		invite: { ...toSummary(row), createdByName: null },
		token,
		url: inviteUrl(token)
	};
}

const toSummary = (
	row: typeof workspaceInviteLink.$inferSelect
): Omit<InviteLinkSummary, 'createdByName'> => ({
	id: row.id,
	role: row.role === 'admin' ? 'admin' : 'member',
	email: row.email,
	maxUses: row.maxUses,
	useCount: row.useCount,
	expiresAt: row.expiresAt,
	createdAt: row.createdAt,
	status: inviteStatus(row)
});

export async function listInviteLinks(actor: WorkspaceActor): Promise<InviteLinkSummary[]> {
	await assertCompanyAdminAction(actor);
	const rows = await db
		.select({ link: workspaceInviteLink, createdByName: user.name })
		.from(workspaceInviteLink)
		.leftJoin(user, eq(user.id, workspaceInviteLink.createdBy))
		.where(eq(workspaceInviteLink.workspaceId, actor.workspaceId))
		.orderBy(desc(workspaceInviteLink.createdAt));
	return rows.map(({ link, createdByName }) => ({ ...toSummary(link), createdByName }));
}

export async function revokeInviteLink(actor: WorkspaceActor, inviteId: string) {
	await assertCompanyAdminAction(actor);
	const [row] = await db
		.update(workspaceInviteLink)
		.set({ revokedAt: new Date() })
		.where(
			and(
				eq(workspaceInviteLink.id, inviteId),
				eq(workspaceInviteLink.workspaceId, actor.workspaceId),
				isNull(workspaceInviteLink.revokedAt)
			)
		)
		.returning({ id: workspaceInviteLink.id });
	if (!row) error(404, 'Invite link not found.', { code: 'NOT_FOUND' });
	await record({
		type: 'invite.revoked',
		outcome: 'success',
		workspaceId: actor.workspaceId,
		userId: actor.userId,
		metadata: { inviteId }
	});
}

async function findByToken(token: string) {
	if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
	const [row] = await db
		.select({
			link: workspaceInviteLink,
			workspaceName: organization.name,
			workspaceSlug: organization.slug,
			kind: organization.kind,
			suspendedAt: organization.suspendedAt,
			deleteScheduledAt: organization.deleteScheduledAt
		})
		.from(workspaceInviteLink)
		.innerJoin(organization, eq(organization.id, workspaceInviteLink.workspaceId))
		.where(eq(workspaceInviteLink.tokenHash, await hashInviteToken(token)))
		.limit(1);
	return row ?? null;
}

async function isMember(workspaceId: string, userId: string) {
	const [row] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.organizationId, workspaceId), eq(member.userId, userId)))
		.limit(1);
	return !!row;
}

/** What the invite page shows; `viewer` personalises the status (email, membership) */
export async function getInvitePreview(
	token: string,
	viewer?: { id: string; email: string } | null
): Promise<InvitePreview> {
	const found = await findByToken(token);
	if (!found || found.kind !== 'company' || found.suspendedAt || found.deleteScheduledAt) {
		return { status: 'invalid' };
	}
	const base = {
		workspaceName: found.workspaceName,
		workspaceSlug: found.workspaceSlug,
		role: (found.link.role === 'admin' ? 'admin' : 'member') as GrantableRole
	};
	if (viewer && (await isMember(found.link.workspaceId, viewer.id))) {
		return { status: 'already_member', ...base };
	}
	const status = inviteStatus(found.link);
	if (status !== 'active') return { status, ...base };
	if (viewer && found.link.email && found.link.email !== viewer.email.toLowerCase()) {
		return { status: 'email_mismatch', ...base };
	}
	return { status: 'active', ...base };
}

/**
 * Joins the workspace of a valid invite link. Admin invites require a passkey. The use
 * counter is incremented with a conditional update, so concurrent acceptances cannot exceed
 * `maxUses`. Returns the workspace slug.
 */
export async function acceptInvite(
	viewer: { id: string; email: string },
	token: string
): Promise<{ slug: string }> {
	const preview = await getInvitePreview(token, viewer);
	if (preview.status === 'already_member') return { slug: preview.workspaceSlug };
	if (preview.status !== 'active') {
		const messages: Record<string, string> = {
			invalid: 'This invite link is not valid.',
			expired: 'This invite link has expired. Ask an admin for a new one.',
			revoked: 'This invite link was revoked.',
			used: 'This invite link has already been used.',
			email_mismatch: 'This invite link is meant for a different email address.'
		};
		error(400, messages[preview.status] ?? messages.invalid, { code: 'INVALID_INPUT' });
	}
	if (preview.role === 'admin' && !(await hasSecondFactor(viewer.id))) {
		secondFactorError('Add a passkey to join as an admin.');
	}

	const found = (await findByToken(token))!;
	const now = new Date();
	const [claimed] = await db
		.update(workspaceInviteLink)
		.set({ useCount: sql`${workspaceInviteLink.useCount} + 1` })
		.where(
			and(
				eq(workspaceInviteLink.id, found.link.id),
				isNull(workspaceInviteLink.revokedAt),
				gt(workspaceInviteLink.expiresAt, now),
				or(
					isNull(workspaceInviteLink.maxUses),
					lt(workspaceInviteLink.useCount, workspaceInviteLink.maxUses)
				)
			)
		)
		.returning({ id: workspaceInviteLink.id });
	if (!claimed) error(400, 'This invite link is no longer valid.', { code: 'INVALID_INPUT' });

	const memberId = crypto.randomUUID();
	await db.insert(member).values({
		id: memberId,
		organizationId: found.link.workspaceId,
		userId: viewer.id,
		role: preview.role,
		createdAt: now
	});
	await record({
		type: 'member.joined',
		outcome: 'success',
		workspaceId: found.link.workspaceId,
		userId: viewer.id,
		metadata: { inviteId: found.link.id, memberId, role: preview.role }
	});
	return { slug: preview.workspaceSlug };
}
