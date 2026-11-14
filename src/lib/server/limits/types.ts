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

// ─── Org-ops extensions (additive) ──────────────────────────────────────────

/**
 * Limits beyond the original contract. Every field is editable from `/admin` (platform setting
 * `limits`); env vars give the defaults.
 */
export type ExtendedLimits = Limits & {
	/** Executions per workspace per minute (all members together) */
	rateLimitWorkspaceExecPerMin: number;
	/** Executions per client IP per minute */
	rateLimitIpPerMin: number;
	/** Executions a user may have waiting for a runner slot; more are refused (`RATE_LIMITED`) */
	maxQueuedPerUser: number;
	/** Audit retention (`AUDIT_RETENTION_DAYS` by default) */
	auditRetentionDays: number;
};

export type LimitKey = keyof ExtendedLimits;

export type KillSwitchSummary = {
	id: string;
	scope: 'user' | 'workspace' | 'platform';
	targetId: string | null;
	/** Display label of the target (user email, workspace name) when known */
	targetLabel: string | null;
	reason: string;
	origin: 'workspace_admin' | 'platform_admin';
	activatedAt: Date;
	activatedByName: string | null;
	releasedAt: Date | null;
};

export type ActivateKillSwitchInput = {
	scope: 'user' | 'workspace' | 'platform';
	/** User id or workspace id; omitted for `platform` */
	targetId?: string;
	reason: string;
	origin: 'workspace_admin' | 'platform_admin';
	actorUserId: string;
};

/** Notified after a switch is activated (executions module aborts in-flight runner jobs) */
export type KillSwitchListener = (scope: SuspensionScope & { platform?: boolean }) => void;

export type UsageDelta = {
	executions?: number;
	failedExecutions?: number;
	toolCalls?: number;
	approvalsRequested?: number;
	executionMs?: number;
};

export type UsageRow = Required<UsageDelta> & { workspaceId: string; day: string };

export type ConcurrencySnapshot = { running: number; queued: number; users: number };
