/**
 * Limits, rate limiting and kill switches contract (owner: org-ops).
 *
 * - Rate limits and concurrency live in memory (single instance; reset on restart, accepted).
 * - Effective limits = env defaults (`EXEC_*`, `RATE_LIMIT_EXEC_PER_MIN`) overridden by the
 *   `limits` platform setting.
 * - Kill switches at three levels (user, workspace, platform) plus `connector.suspended_at`.
 *   Activating one revokes sessions, MCP OAuth tokens and running executions in scope; it is
 *   checked before every execution and every bridge call.
 */
export type Limits = {
	execTimeoutMs: number;
	execMaxToolCalls: number;
	execMaxOutputBytes: number;
	rateLimitExecPerMin: number;
	/** Concurrent executions per user and globally (the rest queue) */
	maxConcurrentPerUser: number;
	maxConcurrentGlobal: number;
};

export type RateLimitResult = { allowed: true } | { allowed: false; retryAfterMs: number };

export type SuspensionScope = { userId?: string; workspaceId?: string; connectorId?: string };

export interface LimitsService {
	getLimits(): Promise<Limits>;
	/** Fixed-window counter; `key` like `exec:user:<id>`, `exec:ip:<ip>` */
	checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult;
	/** Waits for a runner slot; call the returned function exactly once when done */
	acquireExecutionSlot(userId: string, signal?: AbortSignal): Promise<() => void>;
	/** Throws an `App.Error` with code `SUSPENDED` when any switch in scope is active */
	assertNotSuspended(scope: SuspensionScope): Promise<void>;
}
