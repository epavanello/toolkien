import { ORIGIN } from '$app/env/private';
import { record } from '#lib/server/audit/index.ts';
import { handleToolCall } from '#lib/server/bridge/index.ts';
import { declarationsFor } from '#lib/server/connectors/index.ts';
import { decryptJsonForWorkspace, encryptJsonForWorkspace } from '#lib/server/crypto/index.ts';
import { db } from '#lib/server/db/index.ts';
import { registerJob } from '#lib/server/jobs/index.ts';
import {
	acquireExecutionSlot,
	assertNotSuspended,
	checkRateLimit,
	getLimits
} from '#lib/server/limits/index.ts';
import { visibleToolIds } from '#lib/server/permissions/index.ts';
import { runner } from '#lib/server/runner/index.ts';
import { getById } from '#lib/server/workspaces/index.ts';
import { createExecutionsService } from './service.ts';

export * from './types.ts';
export {
	APPROVAL_CHOICE_LABELS,
	approvalMessage,
	decisionFromChoice,
	truncateOutput
} from './output.ts';

const service = createExecutionsService({
	db,
	runner,
	handleToolCall,
	connectors: { declarationsFor },
	permissions: { visibleToolIds },
	crypto: { encryptJsonForWorkspace, decryptJsonForWorkspace },
	audit: { record },
	limits: { getLimits, checkRateLimit, acquireExecutionSlot, assertNotSuspended },
	workspaces: { getById },
	origin: ORIGIN
});

export const start = service.start;
export const status = service.status;
export const cancel = service.cancel;
export const listPendingApprovals = service.listPendingApprovals;
export const decideApproval = service.decideApproval;
export const answerApproval = service.answerApproval;
export const getApproval = service.getApproval;
export const expireStale = service.expireStale;
export const abortRunning = service.abortRunning;

/** Expires pending approvals (30 min) and paused/interrupted executions, wiping their state */
try {
	registerJob({
		name: 'executions.expire',
		intervalMs: 60_000,
		runOnStart: true,
		run: async () => {
			await expireStale();
		}
	});
} catch {
	// Already registered (module re-evaluated in dev)
}
