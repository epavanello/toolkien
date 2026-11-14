import { z } from 'zod';
import type { ExecutionOutcome } from '#lib/server/executions/types.ts';
import type { McpDeps } from '../deps.ts';
import { approvalFallback, readApprovalChoice, requestApproval } from '../elicitation.ts';
import {
	defineTool,
	type McpServerLike,
	type ToolEnv,
	type ToolEnvResolver,
	type ToolResult
} from '../register.ts';
import { activeActor } from './discovery.ts';
import { label } from './workspaces.ts';

/** Scripts larger than this are rejected before reaching the runner */
const MAX_CODE_LENGTH = 100_000;

const header = (outcome: ExecutionOutcome) => `Workspace: ${label(outcome.workspace)}`;

/**
 * What the agent sees: the workspace first, then a JSON report. A paused execution asks the
 * human (elicitation or link); it never offers the model a way to approve.
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
	const report = {
		executionId: outcome.executionId,
		status: outcome.status,
		...(outcome.result !== undefined ? { result: outcome.result } : {}),
		...(outcome.logs ? { logs: outcome.logs } : {}),
		...(outcome.truncated ? { truncated: true } : {}),
		...(outcome.error ? { error: outcome.error } : {})
	};
	const next =
		outcome.status === 'running' || outcome.status === 'paused'
			? [`Call execution_status with executionId "${outcome.executionId}" to follow it.`]
			: [];
	return {
		...(outcome.status === 'failed' ? { isError: true } : {}),
		content: [
			{
				type: 'text',
				text: [header(outcome), JSON.stringify(report, null, 2), ...next].join('\n')
			}
		]
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

export function registerExecutionTools(
	server: McpServerLike,
	resolveEnv: ToolEnvResolver,
	deps: McpDeps
) {
	defineTool(server, resolveEnv, {
		name: 'execute',
		title: 'Run a script',
		description: [
			'Step 3 of 3 (search → describe → execute). Runs TypeScript in an isolated sandbox, in the active workspace (named in the result).',
			'`code` is the BODY of an async function: use `await`, and `return` the value you want back. No import/export and no dynamic import.',
			'Each connector instance is a global object named by its namespace, with the functions declared by tools_describe; one script can call several connectors and several instances of the same server. Example:',
			'`const a = await posthogDevmotion.query({ query: "select count() from events" }); const b = await posthogDevpost.query({ query: "select count() from events" }); return { devmotion: a, devpost: b };`.',
			'Type errors against the declarations come back immediately, before anything runs. The return value and console.log output come back, truncated past the output limit: filter or summarize inside the script.',
			'No network, filesystem or environment access: only the declared tool functions.',
			"Some tool calls need the user's approval: the user decides in a dialog or on a Toolkien link, then call execution_status. You can never approve on the user's behalf."
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
				code
			});
			return renderOutcome(env, outcome);
		}
	});

	defineTool(server, resolveEnv, {
		name: 'execution_status',
		title: 'Execution status',
		description:
			'Status of an execution started by execute. When it was waiting for approval and the user has decided, it resumes and returns the result. Use it after the user approved or rejected on the Toolkien link.',
		input: z.object({
			executionId: z
				.string()
				.trim()
				.min(1)
				.max(100)
				.describe('The executionId returned by execute'),
			resume: z
				.boolean()
				.optional()
				.describe('Resume a paused execution once decided (default true)')
		}),
		annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
		handler: async (env, { executionId, resume = true }) => {
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
