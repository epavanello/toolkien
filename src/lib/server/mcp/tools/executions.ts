import { z } from 'zod';
import type { ExecutionOutcome } from '#lib/server/executions/types.ts';
import type { McpDeps } from '../deps.ts';
import {
	approvalFallback,
	pendingApprovalsText,
	readApprovalChoice,
	requestApproval
} from '../elicitation.ts';
import {
	defineTool,
	type McpServerLike,
	type ToolEnv,
	text,
	type ToolEnvResolver,
	type ToolResult
} from '../register.ts';
import { activeActor } from './discovery.ts';
import { label } from './workspaces.ts';

/** Scripts larger than this are rejected before reaching the runner */
const MAX_CODE_LENGTH = 100_000;

const header = (outcome: ExecutionOutcome) => `Workspace: ${label(outcome.workspace)}`;

/** Short results are pretty-printed; past this size compact JSON saves the agent's context */
const PRETTY_LIMIT = 2_000;

/** What to do when a run stopped on a limit (the runner message already names the value) */
const FAILURE_HINTS: Record<string, string> = {
	type_error:
		'Nothing ran. Fix the script against the declarations (tools_describe) and call execute again.',
	timeout:
		'Limit: execution time. Do less per run (fewer or lighter calls, paginate, filter upstream) or split the work across executions.',
	memory: 'Limit: script memory. Keep less data in memory: process pages and return summaries.',
	limit_tool_calls:
		'Limit: tool calls per execution. Batch the work or split it across executions.',
	expired: 'Start a new execution if the user still wants this done.',
	runner_unavailable: 'Temporary: try again in a moment.'
};

function resultText(outcome: ExecutionOutcome): string[] {
	if (outcome.result === undefined) return [];
	const value = outcome.result;
	if (outcome.truncated && typeof value === 'string') {
		return ['Result (JSON text, cut at the output limit):', value];
	}
	if (typeof value === 'string') return ['Result (string):', value];
	const pretty = JSON.stringify(value, null, 2) ?? 'null';
	return ['Result:', pretty.length <= PRETTY_LIMIT ? pretty : (JSON.stringify(value) ?? 'null')];
}

/**
 * What the agent sees: the workspace, a status line, then the result, error and logs as plain
 * text (multi-line diagnostics and logs stay readable, never JSON-escaped). A paused execution
 * asks the human (elicitation or link); it never offers the model a way to approve.
 */
export async function renderOutcome(
	env: ToolEnv,
	outcome: ExecutionOutcome,
	options: { askAgain: boolean } = { askAgain: true }
): Promise<ToolResult> {
	if (outcome.status === 'awaiting_approval' && outcome.approval) {
		return options.askAgain
			? requestApproval(env, outcome.approval, outcome.executionId, header(outcome))
			: approvalFallback(outcome.approval, outcome.executionId, header(outcome));
	}
	const parts = [header(outcome)];
	const code = outcome.error?.code;
	parts.push(`Execution ${outcome.executionId}: ${outcome.status}${code ? ` [${code}]` : ''}`);
	if (outcome.status === 'running') {
		parts.push(
			`Still running. Call execution_status with executionId "${outcome.executionId}" to wait for the result (the script keeps running meanwhile; do not start it again).`
		);
	} else if (outcome.status === 'paused') {
		parts.push(
			`Paused. Call execution_status with executionId "${outcome.executionId}" to resume it once the user has decided.`
		);
	}
	if (outcome.error) {
		parts.push(outcome.error.message);
		const hint = code ? FAILURE_HINTS[code] : undefined;
		if (hint) parts.push(`Hint: ${hint}`);
	}
	if (outcome.warnings) parts.push(outcome.warnings);
	parts.push(...resultText(outcome));
	if (outcome.logs) parts.push('Logs:', outcome.logs);
	return {
		...(outcome.status === 'failed' ? { isError: true } : {}),
		content: [{ type: 'text', text: parts.join('\n') }]
	};
}

/**
 * Second round of an approval we asked for: the client retried the call with the human's answer
 * (form) or after the human visited the approval page (URL). Returns `null` when this call does
 * not continue one of our rounds.
 */
async function continueApproval(
	deps: McpDeps,
	env: ToolEnv,
	executionId?: string
): Promise<ToolResult | null> {
	const state = env.requestState;
	if (state?.kind !== 'approval_form' && state?.kind !== 'approval_url') return null;
	if (executionId && state.executionId !== executionId) return null;
	const { userId } = env.request;

	if (state.kind === 'approval_form') {
		const choice = readApprovalChoice(env.inputResponses);
		if (choice) {
			const outcome = await deps.executions.answerApproval({
				userId,
				approvalId: state.approvalId,
				choice
			});
			return renderOutcome(env, outcome);
		}
	}
	// URL mode, or a dismissed dialog: resume if decided on the page, else point to the link
	const outcome = await deps.executions.status({
		userId,
		executionId: state.executionId,
		resume: true
	});
	const samePending = outcome.approval?.approvalId === state.approvalId;
	return renderOutcome(env, outcome, { askAgain: !samePending });
}

/**
 * `execution_status` without an id: the recovery path when the client gave up on an approval
 * dialog (the model saw a timeout, no executionId, no link). Lists this user's executions
 * started by this connection in the active workspace that wait for approval: the same scope as
 * the active workspace (per connection), so another connection's scripts never show up here.
 */
async function listAwaitingApproval(deps: McpDeps, env: ToolEnv): Promise<ToolResult> {
	const { workspace } = await activeActor(deps, env.request);
	const pending = await deps.executions.listPendingApprovals(env.request.userId, {
		workspaceId: workspace.id,
		connectionId: env.request.connectionId
	});
	return text(
		pendingApprovalsText(
			`Workspace: ${label(workspace)}`,
			pending,
			`${deps.origin}/w/${workspace.slug}/approvals`
		)
	);
}

export function registerExecutionTools(
	server: McpServerLike,
	resolveEnv: ToolEnvResolver,
	deps: McpDeps
) {
	defineTool(server, resolveEnv, {
		name: 'execute',
		title: 'Run a script',
		description: [
			'Step 3 of 3 (search → describe → execute). Runs TypeScript in an isolated sandbox, in the active workspace (named in the result), with no network, filesystem or environment access: only the declared tool functions.',
			'`code` is the BODY of an async function: `await` the calls and `return` what you want back. No imports.',
			'Each connector instance is a global named by its namespace (`github.createIssue(...)`); one script can call several.',
			'Call tools exactly as tools_describe declares them: the script is type-checked first, and each error comes with a hint on what to do. Never silence them (`as any`, `as unknown as`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`): they report real problems.',
			'Tools without an output schema return `ToolTextResult`: read `.text` (often plain text); if it is JSON, use `.json<T>()`, not `JSON.parse(x.text)`. A failed tool call throws `ToolCallError` (`e.code`, `e.path`, `e.message` with the server text): catch it to continue.',
			'Filtering saves context, but a wrong filter drops data silently. Before filtering a result whose shape you have not seen (text, untyped JSON, `Record<string, unknown>`), return one raw item and write the filter on the keys and format you actually saw: never guess field names. Drop whole fields or items you do not need, but do not cut text (`.slice(0, n)`) unless the user asked for an excerpt. Return values, not only key names. When a field you rely on is missing, throw or return the available keys instead of passing `undefined` on.',
			'Output past the output limit is truncated, with a notice: if what you need does not fit, split it across several executions.',
			'Some upstream tools require bookkeeping fields (e.g. conversation ids); pass what their descriptions say, and if a value is only known after a first call, make the first call, read it from the result, then reuse it.',
			"Some tool calls need the user's approval, in a dialog or on a Toolkien link: you can never approve them yourself. If execute timed out or the dialog never appeared, call execution_status without executionId to get the approval links."
		].join(' '),
		input: z.object({
			code: z
				.string()
				.min(1)
				.max(MAX_CODE_LENGTH)
				.describe('Body of an async function (TypeScript): `await` tool calls, `return` the result')
		}),
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
			openWorldHint: true
		},
		handler: async (env, { code }) => {
			const continued = await continueApproval(deps, env);
			if (continued) return continued;
			const { actor } = await activeActor(deps, env.request);
			const outcome = await deps.executions.start({
				actor,
				clientId: env.request.clientId,
				connectionId: env.request.connectionId,
				clientName: env.request.clientName,
				clientInfo: env.request.clientInfo ?? null,
				ip: env.request.clientAddress ?? null,
				code
			});
			return renderOutcome(env, outcome);
		}
	});

	defineTool(server, resolveEnv, {
		name: 'execution_status',
		title: 'Execution status',
		description: [
			'Status of an execution started by execute. Waits for a running execution (up to about 45 s per call) and returns its result; when it was waiting for approval and the user has decided, it resumes and returns the result. Use it after execute answered `running`, or after the user approved or rejected on the Toolkien link.',
			"Without executionId: lists this client's executions in the active workspace that are waiting for the user's approval, with the approval link, tool and expiry of each. Use it when execute timed out or failed while an approval was pending (e.g. the approval dialog never showed up) or when you lost the executionId: give the user the link, and once they decided call execution_status with that executionId.",
			'You can never approve anything yourself: only the user can, in the dialog or on the link.'
		].join(' '),
		input: z.object({
			executionId: z
				.string()
				.trim()
				.min(1)
				.max(100)
				.optional()
				.describe(
					'The executionId returned by execute. Omit it to list the executions waiting for approval'
				),
			resume: z
				.boolean()
				.optional()
				.describe('Resume a paused execution once decided (default true)')
		}),
		annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
		handler: async (env, { executionId, resume = true }) => {
			if (!executionId) return listAwaitingApproval(deps, env);
			const continued = await continueApproval(deps, env, executionId);
			if (continued) return continued;
			const outcome = await deps.executions.status({
				userId: env.request.userId,
				executionId,
				resume
			});
			return renderOutcome(env, outcome);
		}
	});
}
