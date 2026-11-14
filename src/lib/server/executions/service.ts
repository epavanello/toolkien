import { error } from '@sveltejs/kit';
import { and, asc, count, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { AuditEventInput, AuditService } from '#lib/server/audit/types.ts';
import { readSealed, sha256, writeSealed, type SealedPreview } from '#lib/server/bridge/content.ts';
import type { HandleToolCall } from '#lib/server/bridge/types.ts';
import type { ConnectorsService } from '#lib/server/connectors/types.ts';
import type { WorkspaceCrypto } from '#lib/server/crypto/types.ts';
import type { Db } from '#lib/server/db/index.ts';
import {
	approval,
	connector,
	execution,
	executionCall,
	member,
	organization,
	tool,
	usageDaily
} from '#lib/server/db/schema/index.ts';
import type { LimitsService, RateLimitResult } from '#lib/server/limits/types.ts';
import type { PermissionsService } from '#lib/server/permissions/types.ts';
import type { RunnerClient, RunnerResult } from '#lib/server/runner/types.ts';
import type { WorkspaceActor, WorkspacesService } from '#lib/server/workspaces/types.ts';
import { decisionFromChoice, truncateOutput } from './output.ts';
import {
	APPROVAL_TTL_MS,
	type ApprovalPrompt,
	type ApprovalView,
	type ExecutionOutcome,
	type ExecutionsService,
	type PendingApproval
} from './types.ts';

export type ExecutionsDeps = {
	db: Db;
	runner: Pick<RunnerClient, 'run'>;
	handleToolCall: HandleToolCall;
	connectors: Pick<ConnectorsService, 'declarationsFor'>;
	permissions: Pick<PermissionsService, 'visibleToolIds'>;
	crypto: Pick<WorkspaceCrypto, 'encryptJsonForWorkspace' | 'decryptJsonForWorkspace'>;
	audit: Pick<AuditService, 'record'>;
	limits: Pick<
		LimitsService,
		'getLimits' | 'checkRateLimit' | 'acquireExecutionSlot' | 'assertNotSuspended'
	> & {
		/**
		 * Per-user, per-workspace and per-IP limits (org-ops `checkExecutionRateLimits`). Without
		 * it only the per-user limit applies through `checkRateLimit`.
		 */
		checkExecutionRateLimits?: (input: {
			userId: string;
			workspaceId: string;
			ip?: string | null;
		}) => Promise<RateLimitResult>;
	};
	workspaces: Pick<WorkspacesService, 'getById'>;
	/** Public origin, for approval links */
	origin: string;
	now?: () => Date;
	/** V8 heap limit passed to the runner */
	memoryMb?: number;
};

/** Sealed `execution.state_*`: what a resume needs to re-run the script */
type DurableState = { code: string };

type ExecutionRow = typeof execution.$inferSelect;
type ApprovalRow = typeof approval.$inferSelect;
type WorkspaceRef = ExecutionOutcome['workspace'];

/** Extra wall-clock margin over the runner timeout before the app aborts and expires a run */
const GRACE_MS = 10_000;

const FAILURE_MESSAGES: Record<string, string> = {
	expired: 'The approval was not answered within 30 minutes; the execution expired.',
	interrupted: 'The execution was interrupted (server restart) and cannot continue.',
	cancelled: 'The execution was cancelled.',
	suspended: 'Access is suspended for this user or workspace.',
	forbidden: 'You no longer have access to this workspace.',
	code_mismatch: 'The stored script does not match; the execution cannot resume.',
	internal: 'The execution failed.'
};

export type ExecutionsServiceImpl = ExecutionsService;

export function createExecutionsService(deps: ExecutionsDeps): ExecutionsServiceImpl {
	const { db } = deps;
	const clock = deps.now ?? (() => new Date());
	/** Executions running in this process (abort on cancel / kill switch / timeout) */
	const running = new Map<
		string,
		{ controller: AbortController; userId: string; workspaceId: string }
	>();

	const record = (event: AuditEventInput) => deps.audit.record(event).catch(() => {});

	async function workspaceRef(workspaceId: string): Promise<WorkspaceRef> {
		const [row] = await db
			.select({ id: organization.id, slug: organization.slug, name: organization.name })
			.from(organization)
			.where(eq(organization.id, workspaceId))
			.limit(1);
		return row ?? { id: workspaceId, slug: '', name: 'Unknown workspace' };
	}

	async function loadExecution(userId: string, executionId: string) {
		const [row] = await db.select().from(execution).where(eq(execution.id, executionId)).limit(1);
		// 404 for other users' executions: ids cannot be probed
		if (!row || row.userId !== userId) error(404, 'Execution not found.', { code: 'NOT_FOUND' });
		return row;
	}

	/** Wipes every piece of content of an execution: state, cached results, previews */
	async function wipe(executionId: string) {
		await db
			.update(execution)
			.set({ stateCiphertext: null, stateNonce: null, stateKeyVersion: null })
			.where(eq(execution.id, executionId));
		await db
			.update(executionCall)
			.set({ resultCiphertext: null, resultNonce: null, resultKeyVersion: null })
			.where(eq(executionCall.executionId, executionId));
		await db
			.update(approval)
			.set({ previewCiphertext: null, previewNonce: null, previewKeyVersion: null })
			.where(eq(approval.executionId, executionId));
		await db
			.update(approval)
			.set({ status: 'expired' })
			.where(and(eq(approval.executionId, executionId), eq(approval.status, 'pending')));
	}

	async function recordUsage(row: ExecutionRow, failed: boolean, durationMs: number) {
		try {
			const [{ calls }] = await db
				.select({ calls: count() })
				.from(executionCall)
				.where(
					and(
						eq(executionCall.executionId, row.id),
						inArray(executionCall.status, ['completed', 'failed'])
					)
				);
			const [{ approvals }] = await db
				.select({ approvals: count() })
				.from(approval)
				.where(eq(approval.executionId, row.id));
			const day = clock().toISOString().slice(0, 10);
			await db
				.insert(usageDaily)
				.values({
					workspaceId: row.workspaceId,
					day,
					executions: 1,
					failedExecutions: failed ? 1 : 0,
					toolCalls: calls,
					approvalsRequested: approvals,
					executionMs: durationMs
				})
				.onConflictDoUpdate({
					target: [usageDaily.workspaceId, usageDaily.day],
					set: {
						executions: sql`${usageDaily.executions} + 1`,
						failedExecutions: sql`${usageDaily.failedExecutions} + ${failed ? 1 : 0}`,
						toolCalls: sql`${usageDaily.toolCalls} + ${calls}`,
						approvalsRequested: sql`${usageDaily.approvalsRequested} + ${approvals}`,
						executionMs: sql`${usageDaily.executionMs} + ${durationMs}`
					}
				});
		} catch {
			console.error('[executions] usage counter update failed');
		}
	}

	/**
	 * Moves an execution from one of `from` to a terminal status, at most once (conditional
	 * update), then wipes its content and records the audit event. Returns false if another
	 * path got there first.
	 */
	async function terminate(
		row: ExecutionRow,
		from: ExecutionRow['status'][],
		status: 'completed' | 'failed' | 'cancelled',
		errorCode: string | null
	): Promise<boolean> {
		const now = clock();
		const durationMs = Math.max(0, now.getTime() - row.startedAt.getTime());
		const updated = await db
			.update(execution)
			.set({ status, errorCode, finishedAt: now, durationMs, expiresAt: null })
			.where(and(eq(execution.id, row.id), inArray(execution.status, from)))
			.returning({ id: execution.id });
		if (updated.length === 0) return false;
		await wipe(row.id);
		const [{ toolCallCount }] = await db
			.select({ toolCallCount: execution.toolCallCount })
			.from(execution)
			.where(eq(execution.id, row.id));
		await record({
			type: `execution.${status}` as const,
			outcome: status === 'completed' ? 'success' : status === 'cancelled' ? 'success' : 'failure',
			workspaceId: row.workspaceId,
			userId: row.userId,
			clientId: row.clientId,
			executionId: row.id,
			durationMs,
			metadata: { toolCalls: toolCallCount, errorCode }
		});
		await recordUsage(row, status === 'failed', durationMs);
		return true;
	}

	async function connectorNameOf(toolId: string | null): Promise<string> {
		if (!toolId) return 'Unknown connector';
		const [row] = await db
			.select({ name: connector.name })
			.from(tool)
			.innerJoin(connector, eq(connector.id, tool.connectorId))
			.where(eq(tool.id, toolId))
			.limit(1);
		return row?.name ?? 'Unknown connector';
	}

	async function previewText(row: ApprovalRow): Promise<string> {
		const sealed = readSealed({
			ciphertext: row.previewCiphertext,
			nonce: row.previewNonce,
			keyVersion: row.previewKeyVersion
		});
		if (!sealed) return '';
		try {
			const preview = await deps.crypto.decryptJsonForWorkspace<SealedPreview>(
				row.workspaceId,
				sealed
			);
			return preview.text ?? '';
		} catch {
			return '';
		}
	}

	async function promptFor(row: ApprovalRow, workspaceName: string): Promise<ApprovalPrompt> {
		return {
			approvalId: row.id,
			workspaceName,
			connectorName: await connectorNameOf(row.toolId),
			toolPath: row.path,
			argumentsPreview: row.status === 'pending' ? await previewText(row) : '',
			approvalUrl: `${deps.origin}/approve/${row.id}`,
			expiresAt: row.expiresAt
		};
	}

	async function pendingApprovalsOf(executionId: string) {
		return db
			.select()
			.from(approval)
			.where(
				and(
					eq(approval.executionId, executionId),
					eq(approval.status, 'pending'),
					gt(approval.expiresAt, clock())
				)
			)
			.orderBy(asc(approval.callSeq), asc(approval.createdAt));
	}

	/** Tools the script may call: visible to the user and not blocked */
	async function declarationsFor(actor: WorkspaceActor): Promise<string> {
		const rows = await db
			.select({ id: tool.id })
			.from(tool)
			.innerJoin(connector, eq(connector.id, tool.connectorId))
			.where(
				and(
					eq(tool.workspaceId, actor.workspaceId),
					isNull(tool.removedAt),
					or(isNull(connector.ownerUserId), eq(connector.ownerUserId, actor.userId))
				)
			);
		const ids = await deps.permissions.visibleToolIds(
			actor.workspaceId,
			actor.userId,
			rows.map((r) => r.id)
		);
		return deps.connectors.declarationsFor(actor, ids);
	}

	async function failedOutcome(
		row: ExecutionRow,
		workspace: WorkspaceRef,
		code: string,
		message?: string,
		logs?: string
	): Promise<ExecutionOutcome> {
		return {
			executionId: row.id,
			workspace,
			status: 'failed',
			error: { code, message: message ?? FAILURE_MESSAGES[code] ?? FAILURE_MESSAGES.internal },
			...(logs ? { logs } : {})
		};
	}

	/** What the stored row says, without running anything */
	async function currentOutcome(executionId: string): Promise<ExecutionOutcome> {
		const [row] = await db.select().from(execution).where(eq(execution.id, executionId));
		const workspace = await workspaceRef(row.workspaceId);
		if (row.status === 'failed') return failedOutcome(row, workspace, row.errorCode ?? 'internal');
		if (row.status === 'paused') {
			const [pending] = await pendingApprovalsOf(row.id);
			if (pending) {
				return {
					executionId: row.id,
					workspace,
					status: 'awaiting_approval',
					approval: await promptFor(pending, workspace.name)
				};
			}
		}
		return { executionId: row.id, workspace, status: row.status };
	}

	async function finalize(
		row: ExecutionRow,
		result: RunnerResult,
		maxOutputBytes: number
	): Promise<ExecutionOutcome> {
		const workspace = await workspaceRef(row.workspaceId);

		if (result.status === 'paused') {
			const pending = await pendingApprovalsOf(row.id);
			const blocking = pending.find((a) => a.callSeq === result.atSeq) ?? pending[0];
			if (!blocking) {
				await terminate(row, ['running'], 'failed', 'internal');
				return failedOutcome(row, workspace, 'internal');
			}
			const updated = await db
				.update(execution)
				.set({ status: 'paused', expiresAt: blocking.expiresAt })
				.where(and(eq(execution.id, row.id), eq(execution.status, 'running')))
				.returning({ id: execution.id });
			if (updated.length === 0) return currentOutcome(row.id);
			await record({
				type: 'execution.paused',
				outcome: 'pending',
				workspaceId: row.workspaceId,
				userId: row.userId,
				clientId: row.clientId,
				executionId: row.id,
				toolPath: blocking.path,
				metadata: { seq: blocking.callSeq, approvalId: blocking.id }
			});
			return {
				executionId: row.id,
				workspace,
				status: 'awaiting_approval',
				approval: await promptFor(blocking, workspace.name)
			};
		}

		if (result.status === 'completed') {
			const output = truncateOutput(result, maxOutputBytes);
			if (!(await terminate(row, ['running'], 'completed', null))) return currentOutcome(row.id);
			return {
				executionId: row.id,
				workspace,
				status: 'completed',
				result: output.result,
				logs: output.logs,
				truncated: output.truncated
			};
		}

		const logs = truncateOutput(
			{ result: undefined, logs: result.logs, truncated: false },
			maxOutputBytes
		).logs;
		if (!(await terminate(row, ['running'], 'failed', result.code))) return currentOutcome(row.id);
		return failedOutcome(row, workspace, result.code, result.message, logs);
	}

	/** Runs (or re-runs) the script of a `running` execution through the runner and the bridge */
	async function run(row: ExecutionRow, code: string, actor: WorkspaceActor) {
		const limits = await deps.limits.getLimits();
		const controller = new AbortController();
		running.set(row.id, { controller, userId: row.userId, workspaceId: row.workspaceId });
		let release: (() => void) | null = null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let result: RunnerResult;
		try {
			release = await deps.limits.acquireExecutionSlot(row.userId, controller.signal);
			const window = limits.execTimeoutMs + GRACE_MS;
			await db
				.update(execution)
				.set({ expiresAt: new Date(clock().getTime() + window) })
				.where(and(eq(execution.id, row.id), eq(execution.status, 'running')));
			timer = setTimeout(() => controller.abort(), window);
			const declarations = await declarationsFor(actor);
			result = await deps.runner.run(
				{
					executionId: row.id,
					code,
					declarations,
					limits: {
						timeoutMs: limits.execTimeoutMs,
						maxToolCalls: limits.execMaxToolCalls,
						maxOutputBytes: limits.execMaxOutputBytes,
						memoryMb: deps.memoryMb ?? 256
					}
				},
				(call) =>
					deps.handleToolCall(
						{ executionId: row.id, actor, clientId: row.clientId },
						call.seq,
						call.path,
						call.args
					),
				controller.signal
			);
		} catch {
			result = {
				status: 'failed',
				code: controller.signal.aborted ? 'timeout' : 'runner_unavailable',
				message: controller.signal.aborted
					? 'The execution was stopped (time limit or cancellation).'
					: 'The runner is unavailable. Try again later.',
				logs: ''
			};
		} finally {
			if (timer) clearTimeout(timer);
			release?.();
			running.delete(row.id);
		}
		return finalize(row, result, limits.execMaxOutputBytes);
	}

	const start: ExecutionsService['start'] = async ({ actor, clientId, clientName, ip, code }) => {
		const workspace = await deps.workspaces.getById(actor.userId, actor.workspaceId);
		if (!workspace) error(404, 'Workspace not found.', { code: 'NOT_FOUND' });
		if (workspace.suspended || workspace.deleteScheduledAt) {
			error(403, 'This workspace cannot run executions.', { code: 'SUSPENDED' });
		}
		await deps.limits.assertNotSuspended({
			userId: actor.userId,
			workspaceId: actor.workspaceId
		});
		const limits = await deps.limits.getLimits();
		const rate = deps.limits.checkExecutionRateLimits
			? await deps.limits.checkExecutionRateLimits({
					userId: actor.userId,
					workspaceId: actor.workspaceId,
					ip
				})
			: deps.limits.checkRateLimit(`exec:user:${actor.userId}`, limits.rateLimitExecPerMin, 60_000);
		if (!rate.allowed) {
			error(429, `Too many executions. Retry in ${Math.ceil(rate.retryAfterMs / 1000)} s.`, {
				code: 'RATE_LIMITED'
			});
		}

		const sealed = writeSealed(
			await deps.crypto.encryptJsonForWorkspace(actor.workspaceId, {
				code
			} satisfies DurableState)
		);
		const [row] = await db
			.insert(execution)
			.values({
				workspaceId: actor.workspaceId,
				userId: actor.userId,
				clientId,
				status: 'running',
				stateCiphertext: sealed.ciphertext,
				stateNonce: sealed.nonce,
				stateKeyVersion: sealed.keyVersion,
				codeHash: sha256(code),
				expiresAt: new Date(clock().getTime() + limits.execTimeoutMs + GRACE_MS)
			})
			.returning();
		await record({
			type: 'execution.started',
			outcome: 'success',
			workspaceId: row.workspaceId,
			userId: row.userId,
			clientId,
			clientName: clientName ?? null,
			executionId: row.id
		});
		return run(row, code, { ...actor, role: workspace.role });
	};

	const status: ExecutionsService['status'] = async ({ userId, executionId, resume }) => {
		const row = await loadExecution(userId, executionId);
		if (row.status !== 'paused') return currentOutcome(row.id);
		const workspace = await workspaceRef(row.workspaceId);

		if (row.expiresAt && row.expiresAt <= clock()) {
			await terminate(row, ['paused'], 'failed', 'expired');
			return currentOutcome(row.id);
		}
		const [pending] = await pendingApprovalsOf(row.id);
		if (pending) {
			return {
				executionId: row.id,
				workspace,
				status: 'awaiting_approval',
				approval: await promptFor(pending, workspace.name)
			};
		}
		if (!resume) return { executionId: row.id, workspace, status: 'paused' };

		// Claim the resume: only one caller re-runs a paused execution
		const claimed = await db
			.update(execution)
			.set({ status: 'running' })
			.where(and(eq(execution.id, row.id), eq(execution.status, 'paused')))
			.returning();
		if (claimed.length === 0) return currentOutcome(row.id);
		const current = claimed[0];

		const membership = await deps.workspaces.getById(userId, row.workspaceId);
		if (!membership) {
			await terminate(current, ['running'], 'failed', 'forbidden');
			return currentOutcome(row.id);
		}
		try {
			await deps.limits.assertNotSuspended({ userId, workspaceId: row.workspaceId });
		} catch {
			await terminate(current, ['running'], 'failed', 'suspended');
			return currentOutcome(row.id);
		}
		const sealed = readSealed({
			ciphertext: current.stateCiphertext,
			nonce: current.stateNonce,
			keyVersion: current.stateKeyVersion
		});
		const state = sealed
			? await deps.crypto
					.decryptJsonForWorkspace<DurableState>(row.workspaceId, sealed)
					.catch(() => null)
			: null;
		if (!state || sha256(state.code) !== row.codeHash) {
			await terminate(current, ['running'], 'failed', 'code_mismatch');
			return currentOutcome(row.id);
		}
		return run(current, state.code, {
			workspaceId: row.workspaceId,
			userId,
			role: membership.role
		});
	};

	const cancel: ExecutionsService['cancel'] = async ({ userId, executionId }) => {
		const row = await loadExecution(userId, executionId);
		if (row.status !== 'running' && row.status !== 'paused') return;
		running.get(row.id)?.controller.abort();
		await terminate(row, ['running', 'paused'], 'cancelled', null);
	};

	async function toPending(row: ApprovalRow): Promise<PendingApproval> {
		const workspace = await workspaceRef(row.workspaceId);
		return {
			...(await promptFor(row, workspace.name)),
			executionId: row.executionId,
			workspaceId: row.workspaceId,
			status: row.status,
			createdAt: row.createdAt
		};
	}

	const listPendingApprovals: ExecutionsService['listPendingApprovals'] = async (userId) => {
		const rows = await db
			.select()
			.from(approval)
			.where(
				and(
					eq(approval.userId, userId),
					eq(approval.status, 'pending'),
					gt(approval.expiresAt, clock())
				)
			)
			.orderBy(asc(approval.createdAt));
		return Promise.all(rows.map(toPending));
	};

	/** The execution's user decides; an admin/owner of the workspace may decide for a member */
	async function deciderRole(row: ApprovalRow, userId: string): Promise<'self' | 'admin' | null> {
		if (row.userId === userId) return 'self';
		const [membership] = await db
			.select({ role: member.role })
			.from(member)
			.where(and(eq(member.organizationId, row.workspaceId), eq(member.userId, userId)))
			.limit(1);
		return membership?.role === 'owner' || membership?.role === 'admin' ? 'admin' : null;
	}

	async function loadApproval(approvalId: string, userId: string) {
		const [row] = await db.select().from(approval).where(eq(approval.id, approvalId)).limit(1);
		const role = row ? await deciderRole(row, userId) : null;
		if (!row || !role) error(404, 'Approval not found.', { code: 'NOT_FOUND' });
		return { row, role };
	}

	const decideApproval: ExecutionsService['decideApproval'] = async (input) => {
		const { row, role } = await loadApproval(input.approvalId, input.deciderUserId);
		const now = clock();
		if (row.status !== 'pending') {
			error(409, `This approval was already ${row.status}.`, { code: 'CONFLICT' });
		}
		if (row.expiresAt <= now) {
			await db
				.update(approval)
				.set({
					status: 'expired',
					previewCiphertext: null,
					previewNonce: null,
					previewKeyVersion: null
				})
				.where(and(eq(approval.id, row.id), eq(approval.status, 'pending')));
			error(409, 'This approval expired.', { code: 'CONFLICT' });
		}

		// Keep only the arguments hash: the human-readable preview is wiped once decided
		const sealed = readSealed({
			ciphertext: row.previewCiphertext,
			nonce: row.previewNonce,
			keyVersion: row.previewKeyVersion
		});
		const preview = sealed
			? await deps.crypto
					.decryptJsonForWorkspace<SealedPreview>(row.workspaceId, sealed)
					.catch(() => null)
			: null;
		const kept = preview
			? writeSealed(
					await deps.crypto.encryptJsonForWorkspace(row.workspaceId, {
						argsHash: preview.argsHash
					} satisfies SealedPreview)
				)
			: writeSealed(null);

		const approved = input.decision.decision === 'approve';
		const updated = await db
			.update(approval)
			.set({
				status: approved ? 'approved' : 'rejected',
				scope: input.decision.decision === 'approve' ? input.decision.scope : null,
				channel: input.channel ?? 'web',
				decidedBy: input.deciderUserId,
				decidedAt: now,
				previewCiphertext: kept.ciphertext,
				previewNonce: kept.nonce,
				previewKeyVersion: kept.keyVersion
			})
			.where(and(eq(approval.id, row.id), eq(approval.status, 'pending')))
			.returning({ id: approval.id });
		if (updated.length === 0) {
			error(409, 'This approval was already decided.', { code: 'CONFLICT' });
		}
		// The agent now has a fresh window to resume (or the next approval sets its own)
		await db
			.update(execution)
			.set({ expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS) })
			.where(and(eq(execution.id, row.executionId), eq(execution.status, 'paused')));

		const [exec] = await db
			.select({ clientId: execution.clientId })
			.from(execution)
			.where(eq(execution.id, row.executionId));
		await record({
			type: 'approval.decided',
			outcome: approved ? 'success' : 'denied',
			workspaceId: row.workspaceId,
			userId: row.userId,
			clientId: exec?.clientId ?? null,
			toolPath: row.path,
			executionId: row.executionId,
			approvedBy: approved ? role : null,
			approverUserId: input.deciderUserId,
			metadata: {
				approvalId: row.id,
				seq: row.callSeq,
				decision: input.decision.decision,
				scope: input.decision.decision === 'approve' ? input.decision.scope : null,
				channel: input.channel ?? 'web'
			}
		});
	};

	const answerApproval: ExecutionsService['answerApproval'] = async ({
		userId,
		approvalId,
		choice
	}) => {
		const { row } = await loadApproval(approvalId, userId);
		if (row.userId !== userId) error(404, 'Approval not found.', { code: 'NOT_FOUND' });
		await decideApproval({
			approvalId,
			deciderUserId: userId,
			decision: decisionFromChoice(choice),
			channel: 'elicitation'
		});
		return status({ userId, executionId: row.executionId, resume: true });
	};

	const getApproval: ExecutionsService['getApproval'] = async ({ approvalId, viewerUserId }) => {
		const { row, role } = await loadApproval(approvalId, viewerUserId);
		const [exec] = await db
			.select({ status: execution.status })
			.from(execution)
			.where(eq(execution.id, row.executionId));
		const pending = await toPending(row);
		return {
			...pending,
			scope: row.scope,
			decidedAt: row.decidedAt,
			executionStatus: exec?.status ?? 'cancelled',
			canDecide: row.status === 'pending' && row.expiresAt > clock(),
			onBehalfOfOtherUser: role === 'admin'
		} satisfies ApprovalView;
	};

	const expireStale: ExecutionsService['expireStale'] = async (now = clock()) => {
		const expiredApprovals = await db
			.update(approval)
			.set({
				status: 'expired',
				previewCiphertext: null,
				previewNonce: null,
				previewKeyVersion: null
			})
			.where(and(eq(approval.status, 'pending'), lte(approval.expiresAt, now)))
			.returning({ id: approval.id });

		const stale = await db
			.select()
			.from(execution)
			.where(and(inArray(execution.status, ['paused', 'running']), lte(execution.expiresAt, now)));
		let executions = 0;
		for (const row of stale) {
			if (running.has(row.id)) continue;
			const code = row.status === 'paused' ? 'expired' : 'interrupted';
			if (await terminate(row, [row.status], 'failed', code)) executions++;
		}
		return { approvals: expiredApprovals.length, executions };
	};

	const abortRunning: ExecutionsService['abortRunning'] = (scope) => {
		let aborted = 0;
		for (const entry of running.values()) {
			if (scope.userId && entry.userId !== scope.userId) continue;
			if (scope.workspaceId && entry.workspaceId !== scope.workspaceId) continue;
			entry.controller.abort();
			aborted++;
		}
		return aborted;
	};

	return {
		start,
		status,
		cancel,
		listPendingApprovals,
		decideApproval,
		answerApproval,
		getApproval,
		expireStale,
		abortRunning
	};
}
