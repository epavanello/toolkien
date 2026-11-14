import { error } from '@sveltejs/kit';
import { currentLimits, getExtendedLimits } from './settings.ts';
import type { LimitsService, RateLimitResult } from './types.ts';

const MINUTE = 60_000;
const windows = new Map<string, { start: number; count: number }>();

/** Fixed-window counter, in memory (single instance; reset on restart) */
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

/** Drops expired windows so the map does not grow forever (job `limits.prune`) */
export function pruneRateLimits(maxWindowMs = 10 * MINUTE, now = Date.now()) {
	let removed = 0;
	for (const [key, value] of windows) {
		if (now - value.start >= maxWindowMs) {
			windows.delete(key);
			removed++;
		}
	}
	return removed;
}

/** Test helper */
export const resetRateLimits = () => windows.clear();

/**
 * Per-user, per-workspace and per-IP execution rate limits. Returns the first limit hit. Counts
 * are consumed in order, so a refused user request does not eat workspace or IP budget.
 */
export async function checkExecutionRateLimits(input: {
	userId: string;
	workspaceId: string;
	ip?: string | null;
}): Promise<RateLimitResult> {
	await getExtendedLimits();
	const limits = currentLimits();
	const checks: [string, number][] = [
		[`exec:user:${input.userId}`, limits.rateLimitExecPerMin],
		[`exec:workspace:${input.workspaceId}`, limits.rateLimitWorkspaceExecPerMin]
	];
	if (input.ip) checks.push([`exec:ip:${input.ip}`, limits.rateLimitIpPerMin]);
	for (const [key, limit] of checks) {
		const result = checkRateLimit(key, limit, MINUTE);
		if (!result.allowed) return result;
	}
	return { allowed: true };
}

/** Same as `checkExecutionRateLimits`, throwing an `App.Error` with code `RATE_LIMITED` */
export async function enforceExecutionRateLimits(input: {
	userId: string;
	workspaceId: string;
	ip?: string | null;
}) {
	const result = await checkExecutionRateLimits(input);
	if (!result.allowed) {
		error(429, `Too many executions. Try again in ${Math.ceil(result.retryAfterMs / 1000)} s.`, {
			code: 'RATE_LIMITED'
		});
	}
}
