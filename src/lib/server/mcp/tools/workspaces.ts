import { inputRequired } from '@modelcontextprotocol/server';
import { z } from 'zod';
import type { WorkspaceSummary } from '#lib/server/workspaces/types.ts';
import type { McpDeps } from '../deps.ts';
import {
	readSwitchConfirmation,
	SWITCH_INPUT_KEY,
	switchElicitation,
	switchMessage
} from '../elicitation.ts';
import {
	defineTool,
	text,
	toolError,
	type McpServerLike,
	type ToolEnv,
	type ToolEnvResolver
} from '../register.ts';
import { createSwitchRequest, getSwitchRequest } from '../switch-requests.ts';
import { applySwitch, recordRefusedSwitch } from '../workspace-switch.ts';

export const label = (workspace: Pick<WorkspaceSummary, 'name' | 'slug'>) =>
	`${workspace.name} (${workspace.slug})`;

function listText(workspaces: WorkspaceSummary[], activeId: string): string {
	const active = workspaces.find((workspace) => workspace.id === activeId);
	const lines = workspaces.map((workspace) => {
		const flags = [
			workspace.kind,
			workspace.role,
			...(workspace.suspended ? ['suspended'] : []),
			...(workspace.deleteScheduledAt ? ['scheduled for deletion'] : [])
		];
		const marker = workspace.id === activeId ? ' [active]' : '';
		return `- ${label(workspace)}: ${flags.join(', ')}${marker}`;
	});
	return [
		`Active workspace: ${active ? label(active) : '(none)'}`,
		``,
		`Workspaces:`,
		...lines,
		``,
		`Switch only when the user asks, with workspace_switch and the workspace slug.`
	].join('\n');
}

const switchInput = z.object({
	workspace: z
		.string()
		.trim()
		.min(1)
		.max(200)
		.describe('Slug (as listed by workspace_list) or id of the workspace to switch to')
});

async function switchWorkspace(
	deps: McpDeps,
	env: ToolEnv,
	{ workspace }: z.infer<typeof switchInput>
) {
	const { userId, clientId, clientName } = env.request;
	const subject = { userId, clientId, clientName };
	const [workspaces, active] = await Promise.all([
		deps.workspaces.listForUser(userId),
		deps.workspaces.getActiveWorkspace(userId, clientId)
	]);
	const target = workspaces.find((item) => item.slug === workspace || item.id === workspace);
	if (!target) {
		return toolError(`No workspace "${workspace}" for this user. Call workspace_list first.`);
	}
	const notSwitched = (reason: string) =>
		text(`${reason} The active workspace is still ${label(active)}.`);
	const switched = () =>
		text(
			`Switched to ${label(target)}. Tool searches and scripts from this client now use this workspace.`
		);

	// Second round (2026-07-28): the human answered the dialog we sent in the first round
	const state = env.requestState;
	if (state?.kind === 'switch_form' && state.toWorkspaceId === target.id) {
		const confirmed = readSwitchConfirmation(env.inputResponses);
		if (confirmed === true) {
			await applySwitch(deps, subject, active.id, target, 'elicitation_form');
			return switched();
		}
		if (confirmed === false) {
			await recordRefusedSwitch(deps, subject, active.id, target.id, 'elicitation_form');
			return notSwitched('The user did not confirm the switch.');
		}
	}
	if (state?.kind === 'switch_url') {
		const request = getSwitchRequest(state.requestId, userId);
		if (request?.status === 'confirmed' && request.toWorkspaceId === target.id) return switched();
		if (request?.status === 'rejected') return notSwitched('The user rejected the switch.');
	}

	if (target.id === active.id) return text(`${label(target)} is already the active workspace.`);

	const message = switchMessage({ clientName, from: active, to: target });
	if (env.era === 'modern' && env.capabilities.elicitation.form) {
		return inputRequired({
			inputRequests: { [SWITCH_INPUT_KEY]: switchElicitation(message, target.name) },
			requestState: await env.mintState({ kind: 'switch_form', toWorkspaceId: target.id })
		});
	}

	const request = createSwitchRequest({
		userId,
		clientId,
		clientName,
		fromWorkspaceId: active.id,
		toWorkspaceId: target.id
	});
	const url = `${deps.origin}/consent?switch=${request.id}`;
	if (env.era === 'modern' && env.capabilities.elicitation.url) {
		return inputRequired({
			inputRequests: { [SWITCH_INPUT_KEY]: inputRequired.elicitUrl({ message, url }) },
			requestState: await env.mintState({ kind: 'switch_url', requestId: request.id })
		});
	}
	return text(
		[
			`Status: pending_confirmation`,
			`The user must confirm switching from ${label(active)} to ${label(target)}.`,
			`Ask the user to open this link (valid for 10 minutes):`,
			url,
			``,
			`Then call workspace_list to check the active workspace. You cannot confirm it yourself.`
		].join('\n')
	);
}

export function registerWorkspaceTools(
	server: McpServerLike,
	resolveEnv: ToolEnvResolver,
	deps: McpDeps
) {
	defineTool(server, resolveEnv, {
		name: 'workspace_list',
		title: 'List workspaces',
		description:
			'List the Toolkien workspaces of the user and show which one is active for this client. Connectors, tools and permissions belong to a workspace; tools_search and execute always work in the active one.',
		input: z.object({}),
		annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		handler: async (env) => {
			const { userId, clientId } = env.request;
			const [workspaces, active] = await Promise.all([
				deps.workspaces.listForUser(userId),
				deps.workspaces.getActiveWorkspace(userId, clientId)
			]);
			return text(listText(workspaces, active.id));
		}
	});

	defineTool(server, resolveEnv, {
		name: 'workspace_switch',
		title: 'Switch workspace',
		description:
			'Change the active workspace of this client. Call it ONLY when the user explicitly asks to work in another workspace. The user must confirm the switch (a dialog in the client, or a link to open); until then nothing changes. Every switch is logged.',
		input: switchInput,
		annotations: {
			readOnlyHint: false,
			destructiveHint: false,
			idempotentHint: true,
			openWorldHint: false
		},
		handler: (env, input) => switchWorkspace(deps, env, input)
	});
}
