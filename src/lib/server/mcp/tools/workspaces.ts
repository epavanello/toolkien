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
import { findPendingSwitch, getSwitchRequest } from '../switch-requests.ts';
import { decideSwitchRequest, openSwitchRequest } from '../workspace-switch.ts';

export const label = (workspace: Pick<WorkspaceSummary, 'name' | 'slug'>) =>
	`${workspace.name} (${workspace.slug})`;

function listText(
	workspaces: WorkspaceSummary[],
	activeId: string,
	client: { name: string | null; info: string | null }
): string {
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
		`Connected as: ${client.name ?? 'Unnamed MCP client'}${client.info ? ` (${client.info})` : ''}`,
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
	const { userId, clientId, connectionId, clientName } = env.request;
	const clientInfo = env.request.clientInfo ?? null;
	const subject = { userId, clientId, connectionId, clientName, clientInfo };
	const [workspaces, active] = await Promise.all([
		deps.workspaces.listForUser(userId),
		deps.workspaces.getActiveWorkspace(userId, connectionId)
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

	// Second round (2026-07-28): the human answered the dialog, or settled the request on a page
	const state = env.requestState;
	if (state?.kind === 'switch_form' || state?.kind === 'switch_url') {
		const confirmed =
			state.kind === 'switch_form' ? readSwitchConfirmation(env.inputResponses) : undefined;
		if (confirmed !== undefined) {
			await decideSwitchRequest(deps, {
				requestId: state.requestId,
				userId,
				confirm: confirmed,
				channel: 'elicitation_form'
			});
		}
		const request = getSwitchRequest(state.requestId, userId);
		if (!request && target.id !== active.id) return notSwitched('The switch request expired.');
		if (request?.toWorkspaceId === target.id) {
			if (request.status === 'confirmed') return switched();
			if (request.status === 'rejected') return notSwitched('The user did not confirm the switch.');
		}
	}

	if (target.id === active.id) return text(`${label(target)} is already the active workspace.`);

	const pageUrl = (id: string) => `${deps.origin}/consent?switch=${id}`;
	const pending = (id: string) =>
		text(
			[
				`Status: pending_confirmation`,
				`The user must confirm switching from ${label(active)} to ${label(target)}.`,
				`Ask the user to open this link (valid for 10 minutes):`,
				pageUrl(id),
				`The request is also listed on ${deps.origin}/w/${target.slug}/approvals.`,
				``,
				`Then call workspace_list to check the active workspace. You cannot confirm it yourself.`
			].join('\n')
		);

	// Asked again while a request waits (the dialog timed out or was dismissed): no new dialog,
	// the link to the same request
	const waiting = findPendingSwitch(userId, connectionId, target.id);
	if (waiting) return pending(waiting.id);

	const modern = env.era === 'modern';
	const channel = modern && env.capabilities.elicitation.form ? 'elicitation_form' : 'link';
	const request = await openSwitchRequest(deps, subject, active.id, target.id, channel);
	const message = switchMessage({ clientName, from: active, to: target });
	if (channel === 'elicitation_form') {
		return inputRequired({
			inputRequests: {
				[SWITCH_INPUT_KEY]: switchElicitation(
					`${message}\n\nYou can also confirm it at ${pageUrl(request.id)}`,
					target.name
				)
			},
			requestState: await env.mintState({ kind: 'switch_form', requestId: request.id })
		});
	}
	if (modern && env.capabilities.elicitation.url) {
		return inputRequired({
			inputRequests: {
				[SWITCH_INPUT_KEY]: inputRequired.elicitUrl({ message, url: pageUrl(request.id) })
			},
			requestState: await env.mintState({ kind: 'switch_url', requestId: request.id })
		});
	}
	return pending(request.id);
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
			'List the Toolkien workspaces of the user, show which one is active for this client and which client Toolkien sees. Connectors, tools and permissions belong to a workspace; tools_search and execute always work in the active one.',
		input: z.object({}),
		annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
		handler: async (env) => {
			const { userId, connectionId } = env.request;
			const [workspaces, active] = await Promise.all([
				deps.workspaces.listForUser(userId),
				deps.workspaces.getActiveWorkspace(userId, connectionId)
			]);
			return text(
				listText(workspaces, active.id, {
					name: env.request.clientName,
					info: env.request.clientInfo ?? null
				})
			);
		}
	});

	defineTool(server, resolveEnv, {
		name: 'workspace_switch',
		title: 'Switch workspace',
		description:
			'Change the active workspace of this client. Call it ONLY when the user explicitly asks to work in another workspace. The user must confirm the switch (a dialog in the client, or a link to open); until then nothing changes. If the dialog timed out or never appeared, call it again with the same workspace: it returns the confirmation link instead of asking again. Every switch is logged.',
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
