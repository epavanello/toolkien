import { command, form, getRequestEvent, query } from '$app/server';
import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import { resolve } from '$app/paths';
import { requireUser, requireWorkspace } from '#lib/server/guards.ts';
import {
	activateKillSwitch,
	getUsage,
	listKillSwitches,
	releaseKillSwitch,
	sumUsage,
	utcDay
} from '#lib/server/limits/index.ts';
import {
	acceptInvite,
	assertAdminAction,
	cancelDeletion,
	changeRole,
	createInviteLink,
	createWorkspace,
	deletionState,
	getInvitePreview,
	getPolicy,
	hasRole,
	hasSecondFactor,
	listForUser,
	listInviteLinks,
	listMembers,
	removeMember,
	renameWorkspace,
	revokeInviteLink,
	scheduleDeletion,
	transferOwnership,
	updatePolicy
} from '#lib/server/workspaces/index.ts';

const slug = z.string().min(1).max(100);
const id = z.string().min(1).max(100);
const DAY_MS = 24 * 60 * 60 * 1000;

// ─── Workspace ────────────────────────────────────────────────────────────

/** Settings page data: workspace, deletion state, policy, kill switch and the viewer's powers */
export const getWorkspaceSettings = query(slug, async (workspaceSlug) => {
	const { workspace, actor } = await requireWorkspace(workspaceSlug);
	const isAdmin = hasRole(workspace.role, 'admin');
	const [policy, secondFactor, switches] = await Promise.all([
		getPolicy(workspace.id),
		hasSecondFactor(actor.userId),
		isAdmin ? listKillSwitches({ workspaceId: workspace.id, activeOnly: true }) : []
	]);
	return {
		workspace,
		isAdmin,
		isOwner: workspace.role === 'owner',
		secondFactor,
		/** Admin powers in a company workspace need the viewer's second factor */
		canManage: isAdmin && workspace.kind === 'company' && secondFactor,
		deletion: deletionState(workspace.deleteScheduledAt),
		policy,
		killSwitch: switches[0] ?? null
	};
});

export const createCompanyWorkspace = form(
	z.object({ name: z.string().trim().min(1, { error: 'Enter a name.' }).max(80) }),
	async ({ name }) => {
		const user = requireUser();
		const { slug } = await createWorkspace(user.id, { name });
		redirect(303, resolve('/w/[workspace]/members', { workspace: slug }));
	}
);

export const renameWorkspaceForm = form(
	z.object({
		workspace: slug,
		name: z.string().trim().min(1, { error: 'Enter a name.' }).max(80)
	}),
	async ({ workspace, name }) => {
		const { actor } = await requireWorkspace(workspace, 'admin');
		await renameWorkspace(actor, { name });
		void getWorkspaceSettings(workspace).refresh();
	}
);

export const updatePolicyForm = form(
	z.object({
		workspace: slug,
		/** One directory id or https URL per line; empty = every server */
		allowedServers: z.string().max(10_000).optional(),
		allowPersonalConnectors: z.boolean().default(false),
		allowFreeUrls: z.boolean().default(false),
		permissionFloor: z.enum(['', 'allow', 'ask', 'block']).default('')
	}),
	async (input) => {
		const { actor } = await requireWorkspace(input.workspace, 'admin');
		const lines = (input.allowedServers ?? '')
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean);
		await updatePolicy(actor, {
			allowedServers: lines.length > 0 ? lines : null,
			allowPersonalConnectors: input.allowPersonalConnectors,
			allowFreeUrls: input.allowFreeUrls,
			permissionFloor: input.permissionFloor || null
		});
		void getWorkspaceSettings(input.workspace).refresh();
	}
);

export const scheduleWorkspaceDeletion = form(
	z.object({ workspace: slug, confirm: z.string().trim().min(1, { error: 'Type the slug.' }) }),
	async ({ workspace, confirm }) => {
		const { actor } = await requireWorkspace(workspace, 'owner');
		await scheduleDeletion(actor, { confirm });
		void getWorkspaceSettings(workspace).refresh();
	}
);

export const cancelWorkspaceDeletion = command(slug, async (workspace) => {
	const { actor } = await requireWorkspace(workspace, 'owner');
	await cancelDeletion(actor);
	void getWorkspaceSettings(workspace).refresh();
});

/** Usage of the last 30 days (UTC), for the settings page */
export const getWorkspaceUsage = query(slug, async (workspaceSlug) => {
	const { workspace } = await requireWorkspace(workspaceSlug);
	const to = new Date();
	const rows = await getUsage({
		workspaceId: workspace.id,
		from: utcDay(new Date(to.getTime() - 29 * DAY_MS)),
		to: utcDay(to)
	});
	return sumUsage(rows);
});

// ─── Workspace kill switch (admins) ──────────────────────────────────────

export const suspendWorkspace = form(
	z.object({
		workspace: slug,
		reason: z.string().trim().min(3, { error: 'Give a short reason.' }).max(500)
	}),
	async ({ workspace, reason }) => {
		const { actor } = await requireWorkspace(workspace, 'admin');
		await assertAdminAction(actor);
		await activateKillSwitch({
			scope: 'workspace',
			targetId: actor.workspaceId,
			reason,
			origin: 'workspace_admin',
			actorUserId: actor.userId
		});
		void getWorkspaceSettings(workspace).refresh();
	}
);

export const resumeWorkspace = command(
	z.object({ workspace: slug, id }),
	async ({ workspace, id }) => {
		const { actor } = await requireWorkspace(workspace, 'admin');
		await assertAdminAction(actor);
		await releaseKillSwitch({
			id,
			actorUserId: actor.userId,
			asPlatformAdmin: false,
			workspaceId: actor.workspaceId
		});
		void getWorkspaceSettings(workspace).refresh();
	}
);

// ─── Members ─────────────────────────────────────────────────────────────

export const getMembers = query(slug, async (workspaceSlug) => {
	const { workspace, actor } = await requireWorkspace(workspaceSlug);
	const isAdmin = hasRole(workspace.role, 'admin');
	const secondFactor = await hasSecondFactor(actor.userId);
	/** Admin powers in a company workspace need the viewer's second factor */
	const canManage = isAdmin && workspace.kind === 'company' && secondFactor;
	return {
		workspace,
		viewerId: actor.userId,
		isAdmin,
		isOwner: workspace.role === 'owner',
		canManage,
		needsSecondFactor: isAdmin && workspace.kind === 'company' && !secondFactor,
		members: await listMembers(actor),
		invites: canManage ? await listInviteLinks(actor) : []
	};
});

export const changeMemberRole = command(
	z.object({ workspace: slug, userId: id, role: z.enum(['admin', 'member']) }),
	async ({ workspace, userId, role }) => {
		const { actor } = await requireWorkspace(workspace, 'admin');
		await changeRole(actor, userId, role);
		void getMembers(workspace).refresh();
	}
);

export const removeWorkspaceMember = command(
	z.object({ workspace: slug, userId: id }),
	async ({ workspace, userId }) => {
		const { actor } = await requireWorkspace(workspace);
		await removeMember(actor, userId);
		if (userId === actor.userId) {
			const personal = (await listForUser(actor.userId)).find((w) => w.kind === 'personal');
			return { left: true, redirectTo: personal?.slug ?? null };
		}
		void getMembers(workspace).refresh();
		return { left: false, redirectTo: null };
	}
);

export const transferWorkspaceOwnership = command(
	z.object({ workspace: slug, userId: id }),
	async ({ workspace, userId }) => {
		const { actor } = await requireWorkspace(workspace, 'owner');
		await transferOwnership(actor, userId);
		void getMembers(workspace).refresh();
	}
);

// ─── Invite links ────────────────────────────────────────────────────────

export const createInvite = form(
	z.object({
		workspace: slug,
		role: z.enum(['member', 'admin']).default('member'),
		email: z.union([z.literal(''), z.email({ error: 'Enter a valid email address.' })]).optional(),
		maxUses: z.number().int().min(1).max(1000).optional(),
		expiresInDays: z.number().int().min(1).max(30).default(7)
	}),
	async ({ workspace, ...input }) => {
		const { actor } = await requireWorkspace(workspace, 'admin');
		const { url } = await createInviteLink(actor, { ...input, email: input.email || null });
		void getMembers(workspace).refresh();
		return { url };
	}
);

export const revokeInvite = command(
	z.object({ workspace: slug, id }),
	async ({ workspace, id }) => {
		const { actor } = await requireWorkspace(workspace, 'admin');
		await revokeInviteLink(actor, id);
		void getMembers(workspace).refresh();
	}
);

const token = z.string().min(20).max(100);

/** Public: what an invite link leads to (the viewer may be signed out) */
export const getInvite = query(token, async (value) => {
	const { locals } = getRequestEvent();
	const viewer = locals.user ? { id: locals.user.id, email: locals.user.email } : null;
	return { preview: await getInvitePreview(value, viewer), signedIn: !!viewer };
});

export const joinWorkspace = command(token, async (value) => {
	const user = requireUser();
	return acceptInvite({ id: user.id, email: user.email }, value);
});
