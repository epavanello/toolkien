import { command, query } from '$app/server';
import { z } from 'zod';
import {
	APPROVAL_CHOICES,
	cancel,
	decideApproval,
	decisionFromChoice,
	getApproval,
	listPendingApprovals,
	pendingApprovalRow,
	status
} from '#lib/server/executions/index.ts';
import { list as listConnectors } from '#lib/server/connectors/index.ts';
import { requireUser, requireWorkspace } from '#lib/server/guards.ts';
import { pendingSwitchRows } from '#lib/server/mcp/index.ts';

/**
 * Approvals and execution status for the signed-in human. Approvals are decided only here (the
 * approval page) or through an MCP elicitation answered in the client UI: there is no MCP tool
 * that approves, so nothing the model sends can approve.
 */

const id = z.uuid();
const POLL_MS = 1500;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The viewer's pending approvals (no argument previews: those are on the approval page) */
export const watchPendingApprovals = query.live(async function* () {
	const user = requireUser();
	while (true) {
		const pending = await listPendingApprovals(user.id);
		yield pending.map(({ argumentsPreview: _preview, ...approval }) => approval);
		await sleep(POLL_MS * 2);
	}
});

/**
 * The viewer's own pending approvals in one workspace (the workspace "Pending approvals" page),
 * with a one-line arguments preview and the client: the same scope as `/approve`, so an admin
 * sees only their own requests here and decides members' ones through the link they get.
 * Yields only when something changed.
 */
export const watchWorkspaceApprovals = query.live(
	z.string().min(1).max(100),
	async function* (slug) {
		const { workspace, actor } = await requireWorkspace(slug);
		let last = '';
		while (true) {
			const pending = await listPendingApprovals(actor.userId, { workspaceId: workspace.id });
			const connectors = pending.length ? await listConnectors(actor).catch(() => []) : [];
			const icons = new Map(connectors.map((c) => [c.namespace, c.icon]));
			const rows = pending.map((item) => pendingApprovalRow(item, icons));
			const signature = JSON.stringify(rows);
			if (signature !== last) {
				last = signature;
				yield rows;
			}
			await sleep(POLL_MS * 2);
		}
	}
);

/**
 * The viewer's workspace switches from or to this workspace waiting for an answer: the same
 * requests the client dialog and `/consent?switch=<id>` settle. Yields only when something changed.
 */
export const watchWorkspaceSwitches = query.live(
	z.string().min(1).max(100),
	async function* (slug) {
		const { workspace, actor } = await requireWorkspace(slug);
		let last = '';
		while (true) {
			const rows = await pendingSwitchRows(actor.userId, workspace.id);
			const signature = JSON.stringify(rows);
			if (signature !== last) {
				last = signature;
				yield rows;
			}
			await sleep(POLL_MS * 2);
		}
	}
);

/** One approval with the status of its execution, until both are settled */
export const watchApproval = query.live(id, async function* (approvalId) {
	const user = requireUser();
	while (true) {
		const view = await getApproval({ approvalId, viewerUserId: user.id });
		yield view;
		const settled = view.executionStatus !== 'running' && view.executionStatus !== 'paused';
		if (!view.canDecide && settled) return;
		await sleep(POLL_MS);
	}
});

/** Status of one of the viewer's executions, until it ends */
export const watchExecution = query.live(id, async function* (executionId) {
	const user = requireUser();
	while (true) {
		const outcome = await status({ userId: user.id, executionId, resume: false });
		// Results go to the agent only; the UI gets the status
		yield {
			executionId: outcome.executionId,
			workspace: outcome.workspace,
			status: outcome.status,
			errorCode: outcome.error?.code ?? null
		};
		// `paused` = decided, waiting for the agent to resume: keep watching
		const active = ['running', 'awaiting_approval', 'paused'].includes(outcome.status);
		if (!active) return;
		await sleep(POLL_MS);
	}
});

export const decide = command(
	z.object({ approvalId: id, choice: z.enum(APPROVAL_CHOICES) }),
	async ({ approvalId, choice }) => {
		const user = requireUser();
		await decideApproval({
			approvalId,
			deciderUserId: user.id,
			decision: decisionFromChoice(choice),
			channel: 'web'
		});
	}
);

export const cancelExecution = command(id, async (executionId) => {
	const user = requireUser();
	await cancel({ userId: user.id, executionId });
});
