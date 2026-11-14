/**
 * Pending workspace switches waiting for the human on `/consent?switch=<id>` (out-of-band
 * fallback and URL-mode elicitation). In memory on purpose: one instance, ten-minute lifetime,
 * and losing them on restart only means the agent asks again.
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

export function settleSwitchRequest(id: string, status: PendingWorkspaceSwitch['status']) {
	const request = requests.get(id);
	if (request) request.status = status;
}

/** Test helper */
export function clearSwitchRequests() {
	requests.clear();
}
