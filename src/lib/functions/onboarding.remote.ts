import { query } from '$app/server';
import { z } from 'zod';
import { onboardingStatus } from '#lib/server/clients/index.ts';
import { requireWorkspace } from '#lib/server/guards.ts';

/**
 * Onboarding for the signed-in user in one workspace: the MCP URL, connectors they can see,
 * MCP clients they authorized and whether they already ran a prompt. Live, so the connect page
 * ticks "Connected" while the user signs in from their client; it stops once every step is
 * done (the last value stays).
 */

const POLL_MS = 3000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const watchOnboarding = query.live(z.string().min(1).max(100), async function* (slug) {
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
