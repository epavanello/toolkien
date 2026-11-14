import { and, eq, sql } from 'drizzle-orm';
import type { AuditEventInput, AuditService } from '#lib/server/audit/types.ts';
import type {
	ConnectorsService,
	ResolvedTool,
	UpstreamCallResult
} from '#lib/server/connectors/types.ts';
import type { WorkspaceCrypto } from '#lib/server/crypto/types.ts';
import type { Db } from '#lib/server/db/index.ts';
import {
	approval,
	execution,
	executionCall,
	type ApprovedBy,
	type ExecutionCallStatus
} from '#lib/server/db/schema/index.ts';
import { APPROVAL_TTL_MS } from '#lib/server/executions/types.ts';
import type { LimitsService } from '#lib/server/limits/types.ts';
import { isReadOnly } from '#lib/server/permissions/resolve.ts';
import type { PermissionsService } from '#lib/server/permissions/types.ts';
import {
	argumentsPreview,
	hashArgs,
	readSealed,
	writeSealed,
	type SealedPreview
} from './content.ts';
import type { BridgeContext, HandleToolCall, ToolCallResponse } from './types.ts';

export type BridgeDeps = {
	db: Db;
	connectors: Pick<ConnectorsService, 'resolveTool' | 'callTool' | 'describeTools'>;
	permissions: Pick<PermissionsService, 'getEffectiveLevel'>;
	crypto: Pick<WorkspaceCrypto, 'encryptJsonForWorkspace' | 'decryptJsonForWorkspace'>;
	audit: Pick<AuditService, 'record'>;
	limits: Pick<LimitsService, 'getLimits' | 'assertNotSuspended'>;
	now?: () => Date;
};

/** Sealed payload of `execution_call.result_*`: the outcome replayed on re-runs */
export type CachedCall = {
	argsHash: string;
	outcome: Exclude<ToolCallResponse, { kind: 'pause' }>;
};

const fail = (code: string, message: string): ToolCallResponse => ({
	kind: 'error',
	code,
	message
});

type ExecutionRow = typeof execution.$inferSelect;
type ApprovalRow = typeof approval.$inferSelect;

/**
 * The bridge: the only place that turns a script's tool call into an upstream call. See
 * `types.ts` for the per-call order; deviations are documented in `docs/notes/execution.md`.
 */
export function createBridge(deps: BridgeDeps): HandleToolCall {
	const { db } = deps;
	const clock = deps.now ?? (() => new Date());

	const record = (event: AuditEventInput) => deps.audit.record(event).catch(() => {});

	async function upsertCall(
		exec: ExecutionRow,
		seq: number,
		values: {
			path: string;
			toolId: string | null;
			status: ExecutionCallStatus;
			isWrite: boolean;
		}
	) {
		await db
			.insert(executionCall)
			.values({ executionId: exec.id, seq, ...values })
			.onConflictDoUpdate({
				target: [executionCall.executionId, executionCall.seq],
				set: { status: values.status, toolId: values.toolId, isWrite: values.isWrite }
			});
	}

	async function storeOutcome(
		exec: ExecutionRow,
		seq: number,
		cached: CachedCall,
		durationMs: number
	) {
		const sealed = await deps.crypto.encryptJsonForWorkspace(exec.workspaceId, cached);
		const columns = writeSealed(sealed);
		await db
			.update(executionCall)
			.set({
				status: cached.outcome.kind === 'result' ? 'completed' : 'failed',
				resultCiphertext: columns.ciphertext,
				resultNonce: columns.nonce,
				resultKeyVersion: columns.keyVersion,
				durationMs,
				finishedAt: clock()
			})
			.where(and(eq(executionCall.executionId, exec.id), eq(executionCall.seq, seq)));
	}

	async function openPreview(row: ApprovalRow): Promise<SealedPreview | null> {
		const sealed = readSealed({
			ciphertext: row.previewCiphertext,
			nonce: row.previewNonce,
			keyVersion: row.previewKeyVersion
		});
		if (!sealed) return null;
		try {
			return await deps.crypto.decryptJsonForWorkspace<SealedPreview>(row.workspaceId, sealed);
		} catch {
			return null;
		}
	}

	type Gate =
		| { kind: 'approved'; approvedBy: ApprovedBy; approverUserId: string | null }
		| { kind: 'stop'; response: ToolCallResponse };

	/** `ask` level: an existing decision for this call/tool, or a new pending approval + pause */
	async function approvalGate(
		ctx: BridgeContext,
		exec: ExecutionRow,
		seq: number,
		tool: ResolvedTool,
		args: unknown,
		argsHash: string,
		isWrite: boolean
	): Promise<Gate> {
		const now = clock();
		const rows = await db.select().from(approval).where(eq(approval.executionId, exec.id));
		const decidedBy = (row: ApprovalRow): Gate => ({
			kind: 'approved',
			approvedBy: row.decidedBy && row.decidedBy !== exec.userId ? 'admin' : 'self',
			approverUserId: row.decidedBy
		});

		const toolWide = rows.find(
			(row) =>
				row.status === 'approved' && row.scope === 'tool_in_script' && row.toolId === tool.toolId
		);
		if (toolWide) return decidedBy(toolWide);

		const forSeq = rows.filter((row) => row.callSeq === seq && row.path === tool.path);
		if (forSeq.some((row) => row.status === 'pending' && row.expiresAt > now)) {
			return { kind: 'stop', response: { kind: 'pause' } };
		}
		if (forSeq.some((row) => row.status === 'rejected')) {
			await upsertCall(exec, seq, {
				path: tool.path,
				toolId: tool.toolId,
				status: 'rejected',
				isWrite
			});
			await record({
				type: 'tool.called',
				outcome: 'denied',
				workspaceId: exec.workspaceId,
				userId: exec.userId,
				clientId: ctx.clientId,
				connectorId: tool.connectorId,
				toolPath: tool.path,
				executionId: exec.id,
				metadata: { seq, write: isWrite, reason: 'rejected' }
			});
			return {
				kind: 'stop',
				response: fail('approval_rejected', `The user rejected this call to \`${tool.path}\`.`)
			};
		}
		for (const row of forSeq) {
			if (row.status !== 'approved' || row.scope !== 'once') continue;
			// "Approve once" covers exactly the arguments the human saw
			if ((await openPreview(row))?.argsHash === argsHash) return decidedBy(row);
		}

		const sealed = await deps.crypto.encryptJsonForWorkspace(exec.workspaceId, {
			argsHash,
			text: argumentsPreview(args)
		} satisfies SealedPreview);
		const columns = writeSealed(sealed);
		const expiresAt = new Date(now.getTime() + APPROVAL_TTL_MS);
		const [created] = await db
			.insert(approval)
			.values({
				executionId: exec.id,
				workspaceId: exec.workspaceId,
				userId: exec.userId,
				callSeq: seq,
				toolId: tool.toolId,
				path: tool.path,
				status: 'pending',
				channel: 'web',
				previewCiphertext: columns.ciphertext,
				previewNonce: columns.nonce,
				previewKeyVersion: columns.keyVersion,
				expiresAt
			})
			.returning({ id: approval.id });
		await upsertCall(exec, seq, {
			path: tool.path,
			toolId: tool.toolId,
			status: 'awaiting_approval',
			isWrite
		});
		await record({
			type: 'approval.requested',
			outcome: 'pending',
			workspaceId: exec.workspaceId,
			userId: exec.userId,
			clientId: ctx.clientId,
			connectorId: tool.connectorId,
			toolPath: tool.path,
			executionId: exec.id,
			metadata: { seq, approvalId: created?.id ?? null, write: isWrite }
		});
		return { kind: 'stop', response: { kind: 'pause' } };
	}

	async function errorOutcome(
		ctx: BridgeContext,
		path: string,
		upstream: Extract<UpstreamCallResult, { ok: false }>
	): Promise<CachedCall['outcome']> {
		let message = upstream.message;
		if (upstream.code === 'unknown_tool' || upstream.code === 'invalid_params') {
			// Connectors refreshed the definitions on this failure: hand the agent the new signature
			try {
				const [description] = await deps.connectors.describeTools(ctx.actor, [path]);
				if (description && !message.includes(description.declaration)) {
					message = `${message}\n\nCurrent signature of \`${path}\`:\n${description.declaration}`;
				} else if (!description) {
					message = `${message}\n\n\`${path}\` no longer exists. Use tools_search to find tools.`;
				}
			} catch {
				// The original message is still useful
			}
		}
		return { kind: 'error', code: upstream.code, message };
	}

	return async function handleToolCall(ctx, seq, path, args) {
		if (!Number.isSafeInteger(seq) || seq < 1 || typeof path !== 'string') {
			return fail('invalid_call', 'Invalid tool call.');
		}

		// One execution, one workspace: the context must match the stored execution exactly
		const [exec] = await db
			.select()
			.from(execution)
			.where(eq(execution.id, ctx.executionId))
			.limit(1);
		if (!exec || exec.workspaceId !== ctx.actor.workspaceId || exec.userId !== ctx.actor.userId) {
			return fail('workspace_mismatch', 'This call does not belong to the execution workspace.');
		}
		if (exec.status !== 'running') {
			return fail('execution_not_running', 'The execution is no longer running.');
		}

		try {
			await deps.limits.assertNotSuspended({
				userId: exec.userId,
				workspaceId: exec.workspaceId
			});
		} catch {
			return fail('suspended', 'Access is suspended for this user or workspace.');
		}

		const argsHash = hashArgs(args);

		// Durable replay: a call that already finished returns its sealed outcome, never re-runs
		const [existing] = await db
			.select()
			.from(executionCall)
			.where(and(eq(executionCall.executionId, exec.id), eq(executionCall.seq, seq)))
			.limit(1);
		if (existing) {
			if (existing.path !== path) {
				return fail(
					'replay_mismatch',
					`Call #${seq} is \`${path}\` but was \`${existing.path}\` before the pause. Scripts must make the same calls in the same order when resumed.`
				);
			}
			if (existing.status === 'completed' || existing.status === 'failed') {
				const sealed = readSealed({
					ciphertext: existing.resultCiphertext,
					nonce: existing.resultNonce,
					keyVersion: existing.resultKeyVersion
				});
				const cached = sealed
					? await deps.crypto.decryptJsonForWorkspace<CachedCall>(exec.workspaceId, sealed)
					: null;
				if (!cached) return fail('outcome_unknown', 'The cached result of this call is gone.');
				if (cached.argsHash !== argsHash) {
					return fail(
						'replay_mismatch',
						`Call #${seq} to \`${path}\` has different arguments than before the pause. Completed calls are never repeated or altered.`
					);
				}
				return cached.outcome;
			}
			if (existing.status === 'pending' && existing.isWrite) {
				return fail(
					'outcome_unknown',
					`A previous attempt of call #${seq} to \`${path}\` was interrupted. Its outcome is unknown and writes are never repeated.`
				);
			}
			if (existing.status === 'rejected') {
				return fail('approval_rejected', `The user rejected this call to \`${path}\`.`);
			}
		}

		const limits = await deps.limits.getLimits();
		if (seq > limits.execMaxToolCalls) {
			return fail(
				'limit_tool_calls',
				`Too many tool calls: the limit is ${limits.execMaxToolCalls} per execution.`
			);
		}

		const tool = await deps.connectors.resolveTool(ctx.actor, path);
		if (!tool) {
			return fail('unknown_tool', `No tool \`${path}\` in this workspace. Use tools_search.`);
		}
		if (tool.workspaceId !== exec.workspaceId) {
			await record({
				type: 'tool.called',
				outcome: 'denied',
				workspaceId: exec.workspaceId,
				userId: exec.userId,
				clientId: ctx.clientId,
				toolPath: path,
				executionId: exec.id,
				metadata: { seq, reason: 'workspace_mismatch' }
			});
			return fail('workspace_mismatch', `\`${path}\` is not a tool of this workspace.`);
		}
		try {
			await deps.limits.assertNotSuspended({ connectorId: tool.connectorId });
		} catch {
			return fail('suspended', `The connector of \`${path}\` is suspended.`);
		}

		const isWrite = !isReadOnly(tool.annotations);
		const effective = await deps.permissions.getEffectiveLevel({
			workspaceId: exec.workspaceId,
			userId: exec.userId,
			toolId: tool.toolId
		});
		let approvedBy: ApprovedBy = 'policy';
		let approverUserId: string | null = null;

		if (effective.level === 'block') {
			await upsertCall(exec, seq, { path, toolId: tool.toolId, status: 'blocked', isWrite });
			await record({
				type: 'tool.called',
				outcome: 'denied',
				workspaceId: exec.workspaceId,
				userId: exec.userId,
				clientId: ctx.clientId,
				connectorId: tool.connectorId,
				toolPath: path,
				executionId: exec.id,
				metadata: { seq, write: isWrite, reason: 'blocked' }
			});
			return fail('blocked', `\`${path}\` is blocked by the permissions of this workspace.`);
		}
		if (effective.level === 'ask') {
			const gate = await approvalGate(ctx, exec, seq, tool, args, argsHash, isWrite);
			if (gate.kind === 'stop') return gate.response;
			approvedBy = gate.approvedBy;
			approverUserId = gate.approverUserId;
		}

		// Claim the call before going upstream: an interrupted write is never retried
		await upsertCall(exec, seq, { path, toolId: tool.toolId, status: 'pending', isWrite });
		await db
			.update(execution)
			.set({ toolCallCount: sql`${execution.toolCallCount} + 1` })
			.where(eq(execution.id, exec.id));

		const started = performance.now();
		let upstream: UpstreamCallResult;
		try {
			upstream = await deps.connectors.callTool(ctx.actor, tool, args);
		} catch {
			upstream = { ok: false, code: 'upstream_error', message: 'The upstream call failed.' };
		}
		const durationMs = Math.round(performance.now() - started);

		const outcome: CachedCall['outcome'] = upstream.ok
			? { kind: 'result', value: upstream.structuredContent ?? upstream.content }
			: await errorOutcome(ctx, path, upstream);
		await storeOutcome(exec, seq, { argsHash, outcome }, durationMs);

		await record({
			type: 'tool.called',
			outcome: outcome.kind === 'result' ? 'success' : 'failure',
			workspaceId: exec.workspaceId,
			userId: exec.userId,
			clientId: ctx.clientId,
			connectorId: tool.connectorId,
			toolPath: path,
			executionId: exec.id,
			durationMs,
			approvedBy,
			approverUserId,
			metadata: {
				seq,
				write: isWrite,
				errorCode: outcome.kind === 'error' ? outcome.code : null
			}
		});
		return outcome;
	};
}
