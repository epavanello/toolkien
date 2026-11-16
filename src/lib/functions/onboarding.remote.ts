import { command, form, query } from '$app/server';
import { z } from 'zod';
import {
	CLIENT_LABEL_MAX,
	moveClient,
	onboardingStatus,
	revokeClient,
	setClientLabel
} from '#lib/server/clients/index.ts';
import { requireWorkspace } from '#lib/server/guards.ts';

/**
 * Onboarding for the signed-in user in one workspace: the MCP URL, connectors they can see,
 * MCP clients they authorized and whether they already ran a prompt. Live, so the connect page
 * ticks "Connected" while the user signs in from their client; it stops once every step is
 * done (the last value stays).
 */

const POLL_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const slug = z.string().min(1).max(100);

export const watchOnboarding = query.live(slug, async function* (slug) {
	const { actor } = await requireWorkspace(slug);
	let last = '';
	while (true) {
		const status = await onboardingStatus(actor);
		const signature = JSON.stringify(status);
		if (signature !== last) {
			last = signature;
			yield status;
		}
		if (status.connectors.length > 0 && status.clients.length > 0 && status.triedPrompt) return;
		await sleep(POLL_MS);
	}
});

/**
 * Disconnects one of the user's MCP clients: its consent and tokens are deleted (it must sign in
 * again), and the live onboarding state restarts so every "connected" mark updates.
 */
export const disconnectClient = command(
	z.object({ workspace: slug, clientId: z.string().min(1).max(2048) }),
	async ({ workspace, clientId }) => {
		const { actor } = await requireWorkspace(workspace);
		const { name } = await revokeClient(actor, clientId);
		void watchOnboarding(workspace).reconnect();
		return { name };
	}
);

/**
 * Names one of the user's MCP clients ("Claude Code — work laptop"): the name labels it in the
 * activity from now on. Empty restores the registered name.
 */
export const renameClient = form(
	z.object({
		workspace: slug,
		clientId: z.string().min(1).max(2048),
		label: z
			.string()
			.trim()
			.max(CLIENT_LABEL_MAX, { error: `Keep the name under ${CLIENT_LABEL_MAX} characters.` })
			.optional()
	}),
	async ({ workspace, clientId, label }) => {
		const { actor } = await requireWorkspace(workspace);
		const { name } = await setClientLabel(actor, clientId, label ?? null);
		void watchOnboarding(workspace).reconnect();
		return { name };
	}
);

/**
 * Moves one of the user's MCP clients to another of their workspaces: its next requests work
 * there. The other clients stay where they are.
 */
export const moveClientWorkspace = form(
	z.object({
		workspace: slug,
		clientId: z.string().min(1).max(2048),
		workspaceId: z.string().min(1, { error: 'Choose a workspace.' }).max(100)
	}),
	async ({ workspace, clientId, workspaceId }) => {
		const { actor } = await requireWorkspace(workspace);
		const moved = await moveClient(actor, clientId, workspaceId);
		void watchOnboarding(workspace).reconnect();
		return { name: moved.name, workspace: moved.workspace.name };
	}
);
