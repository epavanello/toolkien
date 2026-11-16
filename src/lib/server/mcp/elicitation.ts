/**
 * Human-in-the-loop plumbing shared by `workspace_switch` and the execution approvals.
 *
 * - 2026-07-28 clients get elicitation through `input_required` results: a form when they
 *   declared `elicitation.form` (or a bare `elicitation: {}`), else a URL to the Toolkien page
 *   when they declared `elicitation.url`. The client retries the same tool call with the
 *   answers and our HMAC-sealed `requestState`, bound to the user and client.
 * - Everyone else (2025-era clients, served statelessly, and clients without elicitation) gets
 *   the out-of-band fallback: a link to the Toolkien page and a pending status.
 *
 * Elicitation answers only ever come from the client UI shown to the human; nothing here is a
 * tool the model can call to approve (there is no approve tool).
 */
import { inputRequired, inputResponse } from '@modelcontextprotocol/server';
import type { CallToolResult, InputRequest } from '@modelcontextprotocol/server';
import {
	APPROVAL_CHOICES,
	type ApprovalChoice,
	type ApprovalPrompt,
	type PendingApproval
} from '#lib/server/executions/types.ts';
import { previewLine } from '#lib/server/executions/output.ts';
import { text, type ToolEnv, type ToolResult } from './register.ts';
import type { McpClientCapabilities } from './types.ts';

/** What we seal into `requestState` between rounds (never content, only ids) */
export type RequestStatePayload =
	| { kind: 'switch_form'; requestId: string }
	| { kind: 'switch_url'; requestId: string }
	| { kind: 'approval_form'; executionId: string; approvalId: string }
	| { kind: 'approval_url'; executionId: string; approvalId: string };

export const NO_ELICITATION: McpClientCapabilities = { elicitation: { form: false, url: false } };

/**
 * Elicitation modes declared in a 2026-07-28 request envelope's client capabilities. A bare
 * `elicitation: {}` means form (the pre-mode meaning); declaring any mode removes the default.
 */
export function elicitationModes(clientCapabilities: unknown): McpClientCapabilities {
	if (!isObject(clientCapabilities)) return NO_ELICITATION;
	const declared = clientCapabilities.elicitation;
	if (!isObject(declared)) return NO_ELICITATION;
	const hasForm = isObject(declared.form);
	const hasUrl = isObject(declared.url);
	return { elicitation: { form: hasForm || (!hasForm && !hasUrl), url: hasUrl } };
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

// ─── Approvals (reused by executions through `execute` / `execution_status`) ─────────────

export const APPROVAL_INPUT_KEY = 'approval';

/** Titles of the three answers (same wording as the Toolkien approval page) */
export const APPROVAL_CHOICE_TITLES: Record<ApprovalChoice, string> = {
	approve_once: 'Approve only this call',
	approve_tool: 'Approve all calls to this tool in this script',
	reject: 'Reject'
};

/** The dialog text: connector, tool, main arguments and workspace, stated explicitly */
export function approvalMessage(prompt: ApprovalPrompt): string {
	return [
		`A script wants to call a tool that needs your approval.`,
		``,
		`Workspace: ${prompt.workspaceName}`,
		`Connector: ${prompt.connectorName}`,
		`Tool: ${prompt.toolPath}`,
		`Arguments: ${prompt.argumentsPreview || '(none)'}`,
		``,
		`This request expires at ${prompt.expiresAt.toISOString()}.`
	].join('\n');
}

/** Form-mode elicitation for one pending approval */
export function approvalElicitation(prompt: ApprovalPrompt): InputRequest {
	return inputRequired.elicit({
		message: approvalMessage(prompt),
		requestedSchema: {
			type: 'object',
			properties: {
				decision: {
					type: 'string',
					title: 'Decision',
					oneOf: APPROVAL_CHOICES.map((choice) => ({
						const: choice,
						title: APPROVAL_CHOICE_TITLES[choice]
					})),
					// Preselected so the human confirms with one click; never `approve_tool`,
					// which would approve every later call to the tool in the same script
					default: 'approve_once' satisfies ApprovalChoice
				}
			},
			required: ['decision']
		}
	});
}

/**
 * Reads the human's answer to an approval form. `undefined` when there is no usable answer
 * (missing, cancelled or malformed): the approval stays pending and the link remains valid.
 * Declining the dialog counts as a rejection.
 */
export function readApprovalChoice(
	responses: Record<string, unknown> | undefined,
	key = APPROVAL_INPUT_KEY
): ApprovalChoice | undefined {
	const answer = inputResponse(responses, key);
	if (answer.kind !== 'elicit') return undefined;
	if (answer.action === 'decline') return 'reject';
	if (answer.action !== 'accept') return undefined;
	const choice = answer.content?.decision;
	return APPROVAL_CHOICES.find((item) => item === choice);
}

/** The fallback without elicitation: approval link and the pending status */
export function approvalFallback(
	prompt: ApprovalPrompt,
	executionId: string,
	header: string
): CallToolResult {
	return text(
		[
			header,
			`Status: awaiting_approval (execution ${executionId})`,
			``,
			`The call to ${prompt.toolPath} (${prompt.connectorName}) needs the user's approval.`,
			`Ask the user to open this link and approve or reject it:`,
			prompt.approvalUrl,
			``,
			`Then call execution_status with executionId "${executionId}". You cannot approve it yourself.`,
			`The request expires at ${prompt.expiresAt.toISOString()}.`
		].join('\n')
	);
}

/**
 * `execution_status` without an id: this client's executions waiting for the user's approval in
 * the active workspace, with their links. The recovery path when an approval dialog timed out
 * on the client (the execution stays paused and its link valid). Links only: approving is
 * always the human's action on the page.
 */
export function pendingApprovalsText(
	header: string,
	pending: PendingApproval[],
	allApprovalsUrl: string
): string {
	if (pending.length === 0) {
		return [
			header,
			'No executions started by this client are waiting for approval in this workspace.',
			`The user sees every pending approval of this workspace at ${allApprovalsUrl}.`
		].join('\n');
	}
	const lines = [header, `Executions waiting for the user's approval (${pending.length}):`, ''];
	for (const item of pending) {
		lines.push(
			`- Execution ${item.executionId}`,
			`  Tool: ${item.toolPath} (${item.connectorName})`,
			`  Arguments: ${previewLine(item.argumentsPreview)}`,
			`  Approval link: ${item.approvalUrl}`,
			`  Expires at: ${item.expiresAt.toISOString()}`,
			''
		);
	}
	lines.push(
		'You cannot approve or reject these yourself. Ask the user to open the approval link and decide,',
		'then call execution_status with that executionId to resume the execution and get its result.'
	);
	return lines.join('\n');
}

/**
 * Asks the human to decide a pending approval: form or URL elicitation when the client can,
 * else the out-of-band fallback.
 */
export async function requestApproval(
	env: ToolEnv,
	prompt: ApprovalPrompt,
	executionId: string,
	header: string
): Promise<ToolResult> {
	if (env.era === 'modern' && env.capabilities.elicitation.form) {
		return inputRequired({
			inputRequests: { [APPROVAL_INPUT_KEY]: approvalElicitation(prompt) },
			requestState: await env.mintState({
				kind: 'approval_form',
				executionId,
				approvalId: prompt.approvalId
			})
		});
	}
	if (env.era === 'modern' && env.capabilities.elicitation.url) {
		return inputRequired({
			inputRequests: {
				[APPROVAL_INPUT_KEY]: inputRequired.elicitUrl({
					message: `Approve or reject the call to ${prompt.toolPath} (${prompt.connectorName}) in workspace ${prompt.workspaceName}.`,
					url: prompt.approvalUrl
				})
			},
			requestState: await env.mintState({
				kind: 'approval_url',
				executionId,
				approvalId: prompt.approvalId
			})
		});
	}
	return approvalFallback(prompt, executionId, header);
}

// ─── Workspace switch ─────────────────────────────────────────────────────────────────────

export const SWITCH_INPUT_KEY = 'confirm_switch';

export function switchMessage(input: {
	clientName: string | null;
	from: { name: string };
	to: { name: string };
}): string {
	const client = input.clientName ?? 'This MCP client';
	return [
		`${client} asks to switch its Toolkien workspace.`,
		``,
		`From: ${input.from.name}`,
		`To: ${input.to.name}`,
		``,
		`Tool searches and scripts from this client will then use the connectors and permissions of "${input.to.name}".`
	].join('\n');
}

export function switchElicitation(message: string, toName: string): InputRequest {
	return inputRequired.elicit({
		message,
		requestedSchema: {
			type: 'object',
			properties: {
				confirm: {
					type: 'boolean',
					title: `Switch to ${toName}`,
					default: false
				}
			},
			required: ['confirm']
		}
	});
}

/** `true` confirmed, `false` refused, `undefined` no usable answer */
export function readSwitchConfirmation(
	responses: Record<string, unknown> | undefined
): boolean | undefined {
	const answer = inputResponse(responses, SWITCH_INPUT_KEY);
	if (answer.kind !== 'elicit') return undefined;
	if (answer.action === 'decline') return false;
	if (answer.action !== 'accept') return undefined;
	return answer.content?.confirm === true;
}
