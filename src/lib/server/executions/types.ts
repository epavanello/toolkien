import type {
	ApprovalScope,
	ApprovalStatus,
	ExecutionStatus
} from '#lib/server/db/schema/index.ts';
import type { WorkspaceActor } from '#lib/server/workspaces/types.ts';

export type { ApprovalScope, ApprovalStatus, ExecutionStatus };

/**
 * Durable executions and approvals contract (owner: execution).
 *
 * Invariants:
 * - One execution = one workspace, fixed at start.
 * - Before running: kill switches, rate limit (`RATE_LIMIT_EXEC_PER_MIN`), concurrency slot
 *   (`#lib/server/limits`).
 * - Pausing persists the sealed state (code + approvals) to the database, never only in memory,
 *   so a paused execution survives restarts and deploys. Resume re-runs the script; completed
 *   calls replay their cached results by `seq`.
 * - State and cached results are wiped when the execution completes, fails, is cancelled or
 *   expires.
 * - Approvals are decided only by the signed-in human: through an elicitation answered in the
 *   client UI or the Toolkien approval page. There is no MCP tool that approves, and nothing the
 *   model sends can count as an approval. Pending approvals expire after 30 minutes.
 * - Output (result + logs) is truncated at `EXEC_MAX_OUTPUT_BYTES` with an explicit notice.
 * - Every outcome names the workspace, so the user always sees where they are operating.
 */

export const APPROVAL_TTL_MS = 30 * 60 * 1000;

export type ApprovalPrompt = {
	approvalId: string;
	workspaceName: string;
	connectorName: string;
	toolPath: string;
	/** Human-readable preview of the main arguments (content, shown only to the approver) */
	argumentsPreview: string;
	/** Absolute URL of the Toolkien approval page (fallback without elicitation) */
	approvalUrl: string;
	expiresAt: Date;
};

export type ExecutionOutcome = {
	executionId: string;
	workspace: { id: string; slug: string; name: string };
	status: ExecutionStatus | 'awaiting_approval';
	/** `completed` */
	result?: unknown;
	logs?: string;
	truncated?: boolean;
	/** `failed`: content-free category + message for the agent */
	error?: { code: string; message: string };
	/** `awaiting_approval` */
	approval?: ApprovalPrompt;
};

export type ApprovalDecision =
	{ decision: 'approve'; scope: ApprovalScope } | { decision: 'reject' };

export type PendingApproval = ApprovalPrompt & {
	executionId: string;
	workspaceId: string;
	status: ApprovalStatus;
	createdAt: Date;
};

export interface ExecutionsService {
	start(input: {
		actor: WorkspaceActor;
		clientId: string | null;
		code: string;
	}): Promise<ExecutionOutcome>;
	/** Status of an execution of this user; with `resume`, continues a paused one if decided */
	status(input: {
		userId: string;
		executionId: string;
		resume: boolean;
	}): Promise<ExecutionOutcome>;
	cancel(input: { userId: string; executionId: string }): Promise<void>;
	listPendingApprovals(userId: string): Promise<PendingApproval[]>;
	/** Called by the approval page or the MCP layer when the human answered an elicitation */
	decideApproval(input: {
		approvalId: string;
		deciderUserId: string;
		decision: ApprovalDecision;
	}): Promise<void>;
	/** Job: expires stale approvals and paused executions, wiping their state */
	expireStale(now?: Date): Promise<{ approvals: number; executions: number }>;
}
