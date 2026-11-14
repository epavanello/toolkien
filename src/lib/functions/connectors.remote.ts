import { command, form, query } from '$app/server';
import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import { z } from 'zod';
import {
	add,
	rename,
	disconnect,
	get,
	list,
	listDirectory,
	remove,
	setToken,
	startOAuth,
	syncTools
} from '#lib/server/connectors/index.ts';
import { requireWorkspace } from '#lib/server/guards.ts';
import { getPolicy, hasRole } from '#lib/server/workspaces/index.ts';
import type { WorkspaceActor, WorkspaceSummary } from '#lib/server/workspaces/types.ts';

const slug = z.string().trim().min(1).max(200);
const id = z.string().trim().min(1).max(100);

/** What the viewer may add, from the workspace policy (admins are not limited by it) */
async function addRights(workspace: WorkspaceSummary, actor: WorkspaceActor) {
	const admin = hasRole(workspace.role, 'admin');
	const policy = await getPolicy(actor.workspaceId);
	return {
		/** Connectors for the whole workspace (shared or per-member accounts) */
		canAddForWorkspace: admin,
		canAddForMe: admin || policy.allowPersonalConnectors,
		canAddUrl: admin || policy.allowFreeUrls
	};
}

/** Connectors the viewer can see, with their auth status for the viewer (metadata only) */
export const listConnectors = query(slug, async (workspaceSlug) => {
	const { workspace, actor } = await requireWorkspace(workspaceSlug);
	return { ...(await addRights(workspace, actor)), connectors: await list(actor) };
});

/** One connector with its tools, signatures and versions */
export const getConnector = query(z.object({ workspace: slug, id }), async ({ workspace, id }) => {
	const { actor } = await requireWorkspace(workspace);
	return get(actor, id);
});

/** The curated directory, with what is already installed in this workspace */
export const listDirectoryServers = query(slug, async (workspaceSlug) => {
	const { workspace, actor } = await requireWorkspace(workspaceSlug);
	const installed = await list(actor);
	return {
		...(await addRights(workspace, actor)),
		servers: listDirectory().map((entry) => ({
			...entry,
			installed: installed.filter((c) => c.directoryId === entry.id).map((c) => c.id)
		}))
	};
});

export const addConnector = form(
	z
		.object({
			workspace: slug,
			source: z.enum(['directory', 'url']),
			directoryId: z.string().trim().max(60).optional(),
			url: z.string().trim().max(2000).optional(),
			name: z.string().trim().max(80).optional(),
			/** Instance label when the same server is added once per account/project */
			label: z.string().trim().max(60).optional(),
			/** Explicit namespace; empty = derived from the server and the label */
			namespace: z.string().trim().max(40).optional(),
			/** `auto` detects OAuth from the server's metadata */
			authType: z.enum(['auto', 'oauth', 'token', 'none']).default('auto'),
			/** `shared`: admin's credential for everyone; `personal`: each member's own; `mine`: only me */
			audience: z.enum(['shared', 'personal', 'mine']).default('mine')
		})
		.refine((v) => (v.source === 'url' ? !!v.url : !!v.directoryId), {
			error: 'Enter the server URL.',
			path: ['url']
		}),
	async (input) => {
		const { actor } = await requireWorkspace(input.workspace);
		const created = await add(actor, {
			scope: input.audience === 'shared' ? 'shared' : 'personal',
			onlyForMe: input.audience === 'mine',
			source:
				input.source === 'directory'
					? { type: 'directory', directoryId: input.directoryId! }
					: { type: 'url', url: input.url! },
			name: input.name || undefined,
			label: input.label || undefined,
			namespace: input.namespace || undefined,
			authType: input.authType === 'auto' ? undefined : input.authType
		});
		void listConnectors(input.workspace).refresh();
		redirect(
			303,
			`${resolve('/w/[workspace]/connectors', { workspace: input.workspace })}?connector=${encodeURIComponent(created.id)}`
		);
	}
);

/** Renames an instance; a new namespace moves its tool paths (agents see new types) */
export const renameConnector = form(
	z.object({
		workspace: slug,
		id,
		label: z.string().trim().max(60).optional(),
		namespace: z.string().trim().min(1, { error: 'Enter a namespace.' }).max(40)
	}),
	async ({ workspace, id, label, namespace }) => {
		const { actor } = await requireWorkspace(workspace);
		await rename(actor, id, { label: label || null, namespace });
		void listConnectors(workspace).refresh();
		void getConnector({ workspace, id }).refresh();
	}
);

/** Stores a pasted token / API key (sealed, validated against the server first) */
export const saveToken = form(
	z.object({
		workspace: slug,
		id,
		token: z.string().trim().min(1, { error: 'Paste the token.' }).max(8192)
	}),
	async ({ workspace, id, token }) => {
		const { actor } = await requireWorkspace(workspace);
		await setToken(actor, id, token);
		void listConnectors(workspace).refresh();
		void getConnector({ workspace, id }).refresh();
	}
);

/** Starts upstream OAuth; the browser navigates to the returned URL */
export const connectOAuth = command(
	z.object({ workspace: slug, id }),
	async ({ workspace, id }) => {
		const { actor } = await requireWorkspace(workspace);
		const returnTo = `${resolve('/w/[workspace]/connectors', { workspace })}?connector=${encodeURIComponent(id)}`;
		return startOAuth(actor, id, returnTo);
	}
);

/** Reloads the tool definitions now (the "refresh" button) */
export const refreshConnector = command(
	z.object({ workspace: slug, id }),
	async ({ workspace, id }) => {
		const { actor } = await requireWorkspace(workspace);
		const result = await syncTools(actor, id, 'manual');
		void listConnectors(workspace).refresh();
		void getConnector({ workspace, id }).refresh();
		return result;
	}
);

/** Forgets (and revokes upstream) the viewer's credential, or the shared one for admins */
export const disconnectConnector = command(
	z.object({ workspace: slug, id }),
	async ({ workspace, id }) => {
		const { actor } = await requireWorkspace(workspace);
		await disconnect(actor, id);
		void listConnectors(workspace).refresh();
		void getConnector({ workspace, id }).refresh();
	}
);

export const removeConnector = command(
	z.object({ workspace: slug, id }),
	async ({ workspace, id }) => {
		const { actor } = await requireWorkspace(workspace);
		await remove(actor, id);
		void listConnectors(workspace).refresh();
		void listDirectoryServers(workspace).refresh();
	}
);
