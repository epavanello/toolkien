/**
 * Applying a workspace switch, shared by `workspace_switch` (elicitation answered in the client)
 * and the Toolkien confirmation page (`/consent?switch=<id>`). Callers have the human's explicit
 * confirmation; every outcome is audited as `workspace.switched`.
 */
import type { WorkspaceSummary } from '#lib/server/workspaces/types.ts';
import type { McpDeps } from './deps.ts';
import { getSwitchRequest, settleSwitchRequest } from './switch-requests.ts';
import type { PendingWorkspaceSwitch } from './types.ts';

export type SwitchChannel = 'elicitation_form' | 'link' | 'consent';

type SwitchSubject = { userId: string; clientId: string; clientName: string | null };

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
		approvedBy: 'self',
		approverUserId: subject.userId,
		metadata: { fromWorkspaceId, channel }
	});
}

export async function recordRefusedSwitch(
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
		metadata: { fromWorkspaceId, channel }
	});
}

/**
 * The human answered on the confirmation page. Returns the settled request, or `null` when it
 * does not exist, expired, belongs to someone else or was already settled.
 */
export async function decideSwitchRequest(
	deps: Pick<McpDeps, 'workspaces' | 'audit'>,
	input: { requestId: string; userId: string; confirm: boolean }
): Promise<PendingWorkspaceSwitch | null> {
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
				'link'
			);
		} else {
			await recordRefusedSwitch(
				deps,
				request,
				request.fromWorkspaceId,
				request.toWorkspaceId,
				'link'
			);
		}
	} catch (cause) {
		settleSwitchRequest(request.id, 'pending');
		throw cause;
	}
	return request;
}
