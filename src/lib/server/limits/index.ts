import {
	EXEC_MAX_OUTPUT_BYTES,
	EXEC_MAX_TOOL_CALLS,
	EXEC_TIMEOUT_MS,
	RATE_LIMIT_EXEC_PER_MIN
} from '$app/env/private';
import type { LimitsService } from './types.ts';

export type * from './types.ts';

/** Env defaults; the `limits` platform setting override is added by org-ops */
export const getLimits: LimitsService['getLimits'] = async () => ({
	execTimeoutMs: EXEC_TIMEOUT_MS,
	execMaxToolCalls: EXEC_MAX_TOOL_CALLS,
	execMaxOutputBytes: EXEC_MAX_OUTPUT_BYTES,
	rateLimitExecPerMin: RATE_LIMIT_EXEC_PER_MIN,
	maxConcurrentPerUser: 4,
	maxConcurrentGlobal: 32
});

const windows = new Map<string, { start: number; count: number }>();

export const checkRateLimit: LimitsService['checkRateLimit'] = (key, limit, windowMs) => {
	const now = Date.now();
	const current = windows.get(key);
	if (!current || now - current.start >= windowMs) {
		windows.set(key, { start: now, count: 1 });
		return { allowed: true };
	}
	if (current.count >= limit) {
		return { allowed: false, retryAfterMs: current.start + windowMs - now };
	}
	current.count++;
	return { allowed: true };
};

/** Placeholder: no queueing yet, every caller gets a slot */
export const acquireExecutionSlot: LimitsService['acquireExecutionSlot'] = async () => () => {};

/** Placeholder: nothing is suspended until org-ops implements kill switches */
export const assertNotSuspended: LimitsService['assertNotSuspended'] = async () => {};
