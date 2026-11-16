/**
 * Workspace switches, shared by `workspace_switch` (elicitation answered in the client) and the
 * Toolkien pages (`/consent?switch=<id>`, linked from "Pending approvals"). Every switch is a
 * request in `switch-requests.ts` first, settled by whichever channel the human answers on;
 * every step is audited as `workspace.switched` (pending, then success or denied).
 */
import type { WorkspaceSummary } from '#lib/server/workspaces/types.ts';
import type { McpDeps } from './deps.ts';
import { createSwitchRequest, getSwitchRequest, settleSwitchRequest } from './switch-requests.ts';
import type { PendingWorkspaceSwitch } from './types.ts';

export type SwitchChannel = 'elicitation_form' | 'link' | 'consent';

type SwitchSubject = {
	userId: string;
	clientId: string;
	clientName: string | null;
	clientInfo?: string | null;
};

/**
 * Opens a switch request and audits it as pending, so a request nobody answers (a dialog that
 * timed out, a link never opened) still leaves a trace.
 */
export async function openSwitchRequest(
	deps: Pick<McpDeps, 'audit'>,
	subject: SwitchSubject,
	fromWorkspaceId: string,
	toWorkspaceId: string,
	channel: SwitchChannel
): Promise<PendingWorkspaceSwitch> {
	const request = createSwitchRequest({
		userId: subject.userId,
		clientId: subject.clientId,
		clientName: subject.clientName,
		clientInfo: subject.clientInfo ?? null,
		fromWorkspaceId,
		toWorkspaceId
	});
	await deps.audit.record({
		type: 'workspace.switched',
		outcome: 'pending',
		workspaceId: toWorkspaceId,
		userId: subject.userId,
		clientId: subject.clientId,
		clientName: subject.clientName,
		clientInfo: subject.clientInfo ?? null,
		metadata: { fromWorkspaceId, channel }
	});
	return request;
}

export async function applySwitch(
	deps: Pick<McpDeps, 'workspaces' | 'audit'>,
	subject: SwitchSubject,
	fromWorkspaceId: string | null,
	to: Pick<WorkspaceSummary, 'id'>,
	channel: SwitchChannel
): Promise<void> {
	await deps.workspaces.setActiveWorkspace(subject.userId, subject.clientId, to.id);
	await deps.audit.record({
		type: 'workspace.switched',
		outcome: 'success',
		workspaceId: to.id,
		userId: subject.userId,
		clientId: subject.clientId,
		clientName: subject.clientName,
		clientInfo: subject.clientInfo ?? null,
		approvedBy: 'self',
		approverUserId: subject.userId,
		metadata: { fromWorkspaceId, channel }
	});
}

async function recordRefusedSwitch(
	deps: Pick<McpDeps, 'audit'>,
	subject: SwitchSubject,
	fromWorkspaceId: string,
	toWorkspaceId: string,
	channel: SwitchChannel
): Promise<void> {
	await deps.audit.record({
		type: 'workspace.switched',
		outcome: 'denied',
		workspaceId: toWorkspaceId,
		userId: subject.userId,
		clientId: subject.clientId,
		clientName: subject.clientName,
		clientInfo: subject.clientInfo ?? null,
		metadata: { fromWorkspaceId, channel }
	});
}

/**
 * The human answered, on the confirmation page (`link`) or in the client dialog. Returns the
 * settled request, or `null` when it does not exist, expired, belongs to someone else or was
 * already settled.
 */
export async function decideSwitchRequest(
	deps: Pick<McpDeps, 'workspaces' | 'audit'>,
	input: { requestId: string; userId: string; confirm: boolean; channel?: SwitchChannel }
): Promise<PendingWorkspaceSwitch | null> {
	const channel = input.channel ?? 'link';
	const request = getSwitchRequest(input.requestId, input.userId);
	if (!request || request.status !== 'pending') return null;
	// Settle first so a double submit cannot apply twice; undo if applying fails
	settleSwitchRequest(request.id, input.confirm ? 'confirmed' : 'rejected');
	try {
		if (input.confirm) {
			await applySwitch(
				deps,
				request,
				request.fromWorkspaceId,
				{ id: request.toWorkspaceId },
				channel
			);
		} else {
			await recordRefusedSwitch(
				deps,
				request,
				request.fromWorkspaceId,
				request.toWorkspaceId,
				channel
			);
		}
	} catch (cause) {
		settleSwitchRequest(request.id, 'pending');
		throw cause;
	}
	return request;
}
