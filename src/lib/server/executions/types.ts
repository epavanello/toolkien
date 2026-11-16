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
	/** `completed` / `failed`: type-check escape hatches the script used (runner text) */
	warnings?: string;
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
	/** MCP client that started the execution (self-asserted name and `name version`; display only) */
	clientName: string | null;
	clientInfo: string | null;
};

/**
 * One row of the workspace's "Pending approvals" page: the viewer's own request, with the
 * arguments preview cut to one line (the approval page shows all of it) and the client label.
 */
export type PendingApprovalRow = {
	approvalId: string;
	executionId: string;
	toolPath: string;
	connectorName: string;
	/** Logo URL Toolkien serves for the connector, `null` for the monogram */
	connectorIcon: string | null;
	argumentsPreview: string;
	/** `Claude Code (claude-code 2.1.3)`; self-asserted by the client, display only */
	client: string | null;
	createdAt: Date;
	expiresAt: Date;
};

/** The three answers offered to the human (elicitation and approval page) */
export const APPROVAL_CHOICES = ['approve_once', 'approve_tool', 'reject'] as const;
export type ApprovalChoice = (typeof APPROVAL_CHOICES)[number];

/** Where the human answered: an MCP elicitation in the client, or the Toolkien page */
export type ApprovalChannel = 'elicitation' | 'web';

/** One approval as the approval page shows it (preview only while pending) */
export type ApprovalView = PendingApproval & {
	scope: ApprovalScope | null;
	decidedAt: Date | null;
	executionStatus: ExecutionStatus;
	/** Pending, not expired, and the viewer may decide */
	canDecide: boolean;
	/** The viewer is an admin deciding for another member */
	onBehalfOfOtherUser: boolean;
};

export interface ExecutionsService {
	start(input: {
		actor: WorkspaceActor;
		clientId: string | null;
		/** (additive) The MCP connection that started it (`mcp_connection.id`) */
		connectionId?: string | null;
		/** Display name of the MCP client, recorded in the audit (activity view) */
		clientName?: string | null;
		/** MCP `clientInfo` (`name version`), recorded with the name; display only */
		clientInfo?: string | null;
		/** Client IP, for the per-IP execution rate limit */
		ip?: string | null;
		code: string;
	}): Promise<ExecutionOutcome>;
	/** Status of an execution of this user; with `resume`, continues a paused one if decided */
	status(input: {
		userId: string;
		executionId: string;
		resume: boolean;
	}): Promise<ExecutionOutcome>;
	cancel(input: { userId: string; executionId: string }): Promise<void>;
	/**
	 * Pending, unexpired approvals of this user's paused executions, oldest first. `scope` narrows
	 * them to one workspace and/or the MCP connection that started the execution (the MCP
	 * `execution_status` listing). Read-only: nothing here decides an approval.
	 */
	listPendingApprovals(
		userId: string,
		scope?: { workspaceId?: string; connectionId?: string }
	): Promise<PendingApproval[]>;
	/** Called by the approval page or the MCP layer when the human answered an elicitation */
	decideApproval(input: {
		approvalId: string;
		deciderUserId: string;
		decision: ApprovalDecision;
		/** Defaults to `web` */
		channel?: ApprovalChannel;
	}): Promise<void>;
	/**
	 * For the MCP layer once the human answered an elicitation (or a retried request carries the
	 * answer): decides with `channel: 'elicitation'` and resumes the execution, returning the new
	 * outcome. `userId` is the verified token's user, never something the model sent.
	 */
	answerApproval(input: {
		userId: string;
		approvalId: string;
		choice: ApprovalChoice;
	}): Promise<ExecutionOutcome>;
	/** Approval page: the execution's user, or an admin/owner of its workspace; else NOT_FOUND */
	getApproval(input: { approvalId: string; viewerUserId: string }): Promise<ApprovalView>;
	/**
	 * Kill switch: aborts running executions in scope on this instance (`{}` = platform: all of
	 * them); returns how many. Paused ones are refused on resume by `assertNotSuspended`.
	 */
	abortRunning(scope: { userId?: string; workspaceId?: string }): number;
	/** Job: expires stale approvals and paused executions, wiping their state */
	expireStale(now?: Date): Promise<{ approvals: number; executions: number }>;
}
