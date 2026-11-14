/**
 * Limits, rate limiting, runner concurrency, kill switches and usage (owner: org-ops). See
 * `types.ts`. Everything rate/concurrency-related is in memory (single instance).
 */
import { currentLimits, getExtendedLimits } from './settings.ts';
import { SlotPool } from './slots.ts';
import type { ConcurrencySnapshot, LimitsService } from './types.ts';

export type * from './types.ts';
export { isPlatformAdminEmail } from './admins.ts';
export {
	activateKillSwitch,
	assertNotSuspended,
	cancelExecutionsInScope,
	invalidateKillSwitchCache,
	listKillSwitches,
	onKillSwitch,
	releaseKillSwitch
} from './kill-switch.ts';
export {
	checkExecutionRateLimits,
	checkRateLimit,
	enforceExecutionRateLimits,
	pruneRateLimits,
	resetRateLimits
} from './rate.ts';
export {
	currentLimits,
	defaultLimits,
	getExtendedLimits,
	LIMIT_FIELDS,
	mergeLimits,
	updateLimits
} from './settings.ts';
export { SlotPool, type SlotLimits } from './slots.ts';
export { getUsage, recordUsage, sumUsage, usageByWorkspace, utcDay } from './usage.ts';

/** Env defaults overridden by the `limits` platform setting (cached 30 s) */
export const getLimits: LimitsService['getLimits'] = () => getExtendedLimits();

const pool = new SlotPool(() => {
	const limits = currentLimits();
	return {
		perUser: limits.maxConcurrentPerUser,
		global: limits.maxConcurrentGlobal,
		maxQueuedPerUser: limits.maxQueuedPerUser
	};
});

/**
 * Waits for a runner slot (per-user and global limits, FIFO queue). Call the returned function
 * exactly once when the execution ends; abort `signal` to leave the queue.
 */
export const acquireExecutionSlot: LimitsService['acquireExecutionSlot'] = async (
	userId,
	signal
) => {
	await getExtendedLimits();
	return pool.acquire(userId, signal);
};

export const concurrencySnapshot = (): ConcurrencySnapshot => pool.snapshot();
