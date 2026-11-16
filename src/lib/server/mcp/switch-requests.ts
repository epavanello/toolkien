/**
 * Every workspace switch an MCP client asks for, whatever the channel (form or URL elicitation,
 * out-of-band link): the one source the dialog answer, `/consent?switch=<id>` and the workspace
 * "Pending approvals" page all read and settle. In memory on purpose: one instance, ten-minute
 * lifetime, and losing them on restart only means the agent asks again.
 */
import { SWITCH_REQUEST_TTL_MS, type PendingWorkspaceSwitch } from './types.ts';

const requests = new Map<string, PendingWorkspaceSwitch>();

function sweep(now: number) {
	for (const [id, request] of requests) {
		if (request.expiresAt.getTime() <= now) requests.delete(id);
	}
}

export function createSwitchRequest(
	input: Omit<PendingWorkspaceSwitch, 'id' | 'status' | 'expiresAt'>,
	now = Date.now()
): PendingWorkspaceSwitch {
	sweep(now);
	const request: PendingWorkspaceSwitch = {
		...input,
		id: crypto.randomUUID(),
		status: 'pending',
		expiresAt: new Date(now + SWITCH_REQUEST_TTL_MS)
	};
	requests.set(request.id, request);
	return request;
}

/** The request if it exists, belongs to `userId` and has not expired */
export function getSwitchRequest(
	id: string,
	userId: string,
	now = Date.now()
): PendingWorkspaceSwitch | null {
	const request = requests.get(id);
	if (!request || request.userId !== userId) return null;
	if (request.expiresAt.getTime() <= now) {
		requests.delete(id);
		return null;
	}
	return request;
}

/** The connection's request still waiting for the human to switch to `toWorkspaceId`, if any */
export function findPendingSwitch(
	userId: string,
	connectionId: string,
	toWorkspaceId: string,
	now = Date.now()
): PendingWorkspaceSwitch | null {
	sweep(now);
	for (const request of requests.values()) {
		if (
			request.status === 'pending' &&
			request.userId === userId &&
			request.connectionId === connectionId &&
			request.toWorkspaceId === toWorkspaceId
		) {
			return request;
		}
	}
	return null;
}

/** The user's pending switches from or to a workspace, oldest first */
export function listPendingSwitches(
	userId: string,
	workspaceId: string,
	now = Date.now()
): PendingWorkspaceSwitch[] {
	sweep(now);
	return [...requests.values()].filter(
		(request) =>
			request.status === 'pending' &&
			request.userId === userId &&
			(request.fromWorkspaceId === workspaceId || request.toWorkspaceId === workspaceId)
	);
}

export function settleSwitchRequest(id: string, status: PendingWorkspaceSwitch['status']) {
	const request = requests.get(id);
	if (request) request.status = status;
}

/** Test helper */
export function clearSwitchRequests() {
	requests.clear();
}
