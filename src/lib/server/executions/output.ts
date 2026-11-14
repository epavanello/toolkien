import type { ApprovalDecision, ApprovalChoice, ApprovalPrompt } from './types.ts';

/** Pure helpers for what goes back to the agent and to the human approver */

const encoder = new TextEncoder();
const byteLength = (text: string) => encoder.encode(text).length;

/** Cuts `text` to at most `max` UTF-8 bytes without splitting a character */
export function cutBytes(text: string, max: number): string {
	if (max <= 0) return '';
	const bytes = encoder.encode(text);
	if (bytes.length <= max) return text;
	return new TextDecoder().decode(bytes.subarray(0, max)).replace(/�+$/, '');
}

export const truncationNotice = (maxBytes: number) =>
	`\n[Toolkien] Output truncated at ${maxBytes} bytes. Return less data: filter, paginate or summarize inside the script.`;

/**
 * Result + logs within `maxBytes`, with an explicit notice when anything was cut (by the runner
 * or here). The result has priority over logs; a result that alone exceeds the budget is replaced
 * by its JSON text, cut.
 */
export function truncateOutput(
	output: { result: unknown; logs: string; truncated: boolean },
	maxBytes: number
): { result: unknown; logs: string; truncated: boolean } {
	const notice = truncationNotice(maxBytes);
	const json = output.result === undefined ? '' : (JSON.stringify(output.result) ?? '');
	const total = byteLength(json) + byteLength(output.logs);
	if (total <= maxBytes && !output.truncated) return { ...output, truncated: false };

	const budget = Math.max(0, maxBytes - byteLength(notice));
	if (byteLength(json) <= budget) {
		const logs = cutBytes(output.logs, budget - byteLength(json));
		return { result: output.result, logs: logs + notice, truncated: true };
	}
	return { result: cutBytes(json, budget), logs: notice.trimStart(), truncated: true };
}

/** Text of the elicitation / approval prompt (content: shown only to the human) */
export function approvalMessage(prompt: ApprovalPrompt): string {
	return [
		'A script wants to call a tool that needs your approval.',
		'',
		`Workspace: ${prompt.workspaceName}`,
		`Connector: ${prompt.connectorName}`,
		`Tool: ${prompt.toolPath}`,
		'Arguments:',
		prompt.argumentsPreview
	].join('\n');
}

export const APPROVAL_CHOICE_LABELS: Record<ApprovalChoice, string> = {
	approve_once: 'Approve only this call',
	approve_tool: 'Approve all calls to this tool in this script',
	reject: 'Reject'
};

export const decisionFromChoice = (choice: ApprovalChoice): ApprovalDecision =>
	choice === 'reject'
		? { decision: 'reject' }
		: { decision: 'approve', scope: choice === 'approve_tool' ? 'tool_in_script' : 'once' };
