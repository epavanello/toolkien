import { and, eq } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { member, organization, workspacePolicy } from '#lib/server/db/schema/index.ts';

/** Slug of a user's personal workspace: stable, unique and free of personal data */
export const personalSlug = (userId: string) =>
	`personal-${userId.toLowerCase().replace(/[^a-z0-9]/g, '')}`;

/**
 * Returns the slug of the user's personal workspace, creating it (organization with
 * `kind = 'personal'`, owner membership, default policy) if it does not exist yet. Idempotent:
 * called on sign-up and again whenever a signed-in user lands without one.
 */
export async function ensurePersonalWorkspace(user: { id: string; name: string }) {
	const [existing] = await db
		.select({ slug: organization.slug })
		.from(organization)
		.innerJoin(member, eq(member.organizationId, organization.id))
		.where(and(eq(member.userId, user.id), eq(organization.kind, 'personal')))
		.limit(1);
	if (existing) return existing.slug;

	const workspaceId = crypto.randomUUID();
	const slug = personalSlug(user.id);
	await db.batch([
		db.insert(organization).values({
			id: workspaceId,
			name: 'Personal',
			slug,
			kind: 'personal',
			createdAt: new Date()
		}),
		db.insert(member).values({
			id: crypto.randomUUID(),
			organizationId: workspaceId,
			userId: user.id,
			role: 'owner',
			createdAt: new Date()
		}),
		db.insert(workspacePolicy).values({ workspaceId })
	]);
	return slug;
}
