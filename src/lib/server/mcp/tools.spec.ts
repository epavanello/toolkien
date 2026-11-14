import { error } from '@sveltejs/kit';
import type { InputRequiredResult, ServerContext } from '@modelcontextprotocol/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotImplementedError } from '#lib/server/not-implemented.ts';
import { elicitationModes } from './elicitation.ts';
import { errorResult, type ToolEnv, type ToolResult } from './register.ts';
import { clearSwitchRequests, getSwitchRequest } from './switch-requests.ts';
import {
	acme,
	fakeDeps,
	fakeEnv,
	fakeServer,
	outcome,
	pendingApproval,
	personal,
	textOf
} from './testing.ts';
import { registerDiscoveryTools } from './tools/discovery.ts';
import { registerExecutionTools } from './tools/executions.ts';
import { registerWorkspaceTools } from './tools/workspaces.ts';
import { MCP_TOOL_NAMES } from './types.ts';
import { decideSwitchRequest } from './workspace-switch.ts';

function setup(options: { active?: typeof personal } = {}) {
	const deps = fakeDeps(options);
	const { server, tools } = fakeServer();
	let env = fakeEnv();
	const resolveEnv = () => env;
	registerWorkspaceTools(server, resolveEnv, deps);
	registerDiscoveryTools(server, resolveEnv, deps);
	registerExecutionTools(server, resolveEnv, deps);
	const call = (name: string, input: unknown, overrides: Partial<ToolEnv> = {}) => {
		env = fakeEnv(overrides);
		return tools.get(name)!.handler(input as never, {} as ServerContext);
	};
	return { deps, tools, call };
}

const asInputRequired = (result: ToolResult) => {
	expect('resultType' in result && result.resultType).toBe('input_required');
	return result as InputRequiredResult;
};

const modernForm = { era: 'modern' as const, capabilities: elicitationModes({ elicitation: {} }) };
const modernUrl = {
	era: 'modern' as const,
	capabilities: elicitationModes({ elicitation: { url: {} } })
};

beforeEach(() => clearSwitchRequests());

describe('tool surface', () => {
	it('registers exactly the six tools and never an approve tool', () => {
		const { tools } = setup();
		expect([...tools.keys()].sort()).toEqual([...MCP_TOOL_NAMES].sort());
		expect([...tools.keys()].some((name) => name.includes('approve'))).toBe(false);
	});

	it('teaches search → describe → execute in the descriptions', () => {
		const { tools } = setup();
		expect(tools.get('tools_search')!.config.description).toMatch(/Step 1 of 3.*tools_describe/s);
		expect(tools.get('tools_describe')!.config.description).toMatch(/Step 2 of 3.*execute/s);
		expect(tools.get('execute')!.config.description).toMatch(/Step 3 of 3/);
		expect(tools.get('execute')!.config.description).toMatch(/never approve/);
		expect(tools.get('workspace_switch')!.config.description).toMatch(/ONLY when the user/);
	});

	it('marks read-only tools', () => {
		const { tools } = setup();
		for (const name of ['workspace_list', 'tools_search', 'tools_describe']) {
			expect(tools.get(name)!.config.annotations?.readOnlyHint).toBe(true);
		}
		expect(tools.get('execute')!.config.annotations?.readOnlyHint).toBe(false);
	});
});

describe('workspace_list', () => {
	it('lists the workspaces and marks the active one', async () => {
		const { call } = setup({ active: acme });
		const text = textOf(await call('workspace_list', {}));
		expect(text).toContain('Active workspace: Acme (acme)');
		expect(text).toMatch(/Acme \(acme\): company, member \[active\]/);
		expect(text).toMatch(/Personal \(personal-u1\): personal, owner$/m);
	});
});

describe('workspace_switch', () => {
	it('rejects unknown workspaces', async () => {
		const { call } = setup();
		const result = await call('workspace_switch', { workspace: 'nope' });
		expect('isError' in result && result.isError).toBe(true);
	});

	it('does nothing when the workspace is already active', async () => {
		const { call, deps } = setup();
		expect(textOf(await call('workspace_switch', { workspace: personal.slug }))).toMatch(
			/already the active/
		);
		expect(deps.workspaces.setActiveWorkspace).not.toHaveBeenCalled();
	});

	it('without elicitation returns a confirmation link and switches only once confirmed', async () => {
		const { call, deps } = setup();
		const text = textOf(await call('workspace_switch', { workspace: 'acme' }));
		expect(text).toContain('pending_confirmation');
		const id = text.match(/consent\?switch=([\w-]+)/)?.[1];
		expect(id).toBeTruthy();
		expect(deps.workspaces.setActiveWorkspace).not.toHaveBeenCalled();

		expect(getSwitchRequest(id!, 'someone-else')).toBeNull();
		await decideSwitchRequest(deps, { requestId: id!, userId: 'u1', confirm: true });
		expect(deps.workspaces.setActiveWorkspace).toHaveBeenCalledWith('u1', 'client-1', acme.id);
		expect(deps.audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'workspace.switched',
				outcome: 'success',
				clientName: 'Test Client',
				metadata: { fromWorkspaceId: personal.id, channel: 'link' }
			})
		);
		// A settled request cannot be decided again
		expect(await decideSwitchRequest(deps, { requestId: id!, userId: 'u1', confirm: true })).toBe(
			null
		);
	});

	it('asks with a form elicitation, then switches on confirmation', async () => {
		const { call, deps } = setup();
		const first = asInputRequired(
			await call('workspace_switch', { workspace: 'acme' }, modernForm)
		);
		const request = first.inputRequests!.confirm_switch;
		expect(request.method).toBe('elicitation/create');
		expect(JSON.stringify(request.params)).toContain('From: Personal');
		expect(JSON.parse(first.requestState!)).toEqual({
			kind: 'switch_form',
			toWorkspaceId: acme.id
		});

		const second = await call(
			'workspace_switch',
			{ workspace: 'acme' },
			{
				...modernForm,
				requestState: { kind: 'switch_form', toWorkspaceId: acme.id },
				inputResponses: { confirm_switch: { action: 'accept', content: { confirm: true } } }
			}
		);
		expect(textOf(second)).toMatch(/Switched to Acme/);
		expect(deps.workspaces.setActiveWorkspace).toHaveBeenCalledWith('u1', 'client-1', acme.id);
	});

	it('records a refusal and keeps the workspace when declined', async () => {
		const { call, deps } = setup();
		const result = await call(
			'workspace_switch',
			{ workspace: 'acme' },
			{
				...modernForm,
				requestState: { kind: 'switch_form', toWorkspaceId: acme.id },
				inputResponses: { confirm_switch: { action: 'decline' } }
			}
		);
		expect(textOf(result)).toMatch(/still Personal/);
		expect(deps.workspaces.setActiveWorkspace).not.toHaveBeenCalled();
		expect(deps.audit.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'denied' }));
	});

	it('uses URL elicitation when only URL mode is declared', async () => {
		const { call } = setup();
		const result = asInputRequired(
			await call('workspace_switch', { workspace: 'acme' }, modernUrl)
		);
		const params = result.inputRequests!.confirm_switch.params as { mode: string; url: string };
		expect(params.mode).toBe('url');
		expect(params.url).toMatch(/^https:\/\/toolkien\.test\/consent\?switch=/);
	});
});

describe('tools_search', () => {
	it('names the workspace, hides blocked tools and flags approvals', async () => {
		const { call } = setup({ active: acme });
		const text = textOf(await call('tools_search', { query: 'github' }));
		expect(text.split('\n')[0]).toBe('Workspace: Acme (acme)');
		expect(text).toContain('github.listIssues');
		expect(text).toMatch(/github\.createIssue: .*asks the user for approval/);
		expect(text).not.toContain('github.deleteRepo');
		expect(text).toContain('tools_describe');
	});

	it('searches as the active workspace actor', async () => {
		const { call, deps } = setup({ active: acme });
		await call('tools_search', { query: 'x', limit: 5 });
		expect(deps.connectors.searchTools).toHaveBeenCalledWith(
			{ workspaceId: acme.id, userId: 'u1', role: 'member' },
			'x',
			5
		);
	});

	it('groups same-named tools by connector instance (one per account)', async () => {
		const { call, deps, tools } = setup();
		expect(tools.get('tools_search')!.config.description).toMatch(/one script can call several/);
		expect(tools.get('execute')!.config.description).toMatch(/BODY of an async function/);
		const hit = (namespace: string, account: string) => ({
			path: `${namespace}.query`,
			summary: 'Run a HogQL query',
			connectorName: 'PostHog',
			unverified: false,
			namespace,
			accountHint: account
		});
		deps.connectors.searchTools.mockResolvedValueOnce([
			hit('posthogDevmotion', 'devmotion'),
			hit('posthogDevpost', 'devpost')
		]);
		deps.connectors.resolveTool.mockImplementation(
			async (_actor, path: string) => ({ toolId: path, path }) as never
		);
		deps.permissions.getEffectiveLevels.mockImplementationOnce(
			async (_ws: string, _user: string, ids: string[]) =>
				new Map(
					ids.map((id) => [id, { level: 'allow', needsConfirmation: false, source: 'default' }])
				)
		);
		const text = textOf(await call('tools_search', { query: 'posthog query' }));
		expect(text).toContain('Several instances of the same server');
		expect(text).toContain('PostHog (account: devmotion), namespace `posthogDevmotion`:');
		expect(text).toContain('PostHog (account: devpost), namespace `posthogDevpost`:');
		expect(text).toContain('- posthogDevpost.query: Run a HogQL query');
	});

	it('explains when nothing matches', async () => {
		const { call, deps } = setup();
		deps.connectors.searchTools.mockResolvedValueOnce([]);
		expect(textOf(await call('tools_search', { query: 'zzz' }))).toMatch(/No tools match "zzz"/);
	});
});

describe('tools_describe', () => {
	it('returns declarations of allowed paths only', async () => {
		const { call, deps } = setup();
		const text = textOf(
			await call('tools_describe', {
				paths: ['github.listIssues', 'github.deleteRepo', 'nope.tool']
			})
		);
		expect(deps.connectors.describeTools).toHaveBeenCalledWith(expect.anything(), [
			'github.listIssues'
		]);
		expect(text).toContain('```ts');
		expect(text).toContain('declare function github.listIssues');
		expect(text).toMatch(
			/Not found or not allowed in this workspace: github\.deleteRepo, nope\.tool/
		);
	});
});

describe('execute', () => {
	it('starts in the active workspace and reports the result with the workspace', async () => {
		const { call, deps } = setup({ active: acme });
		deps.executions.start.mockResolvedValueOnce(
			outcome({ workspace: { id: acme.id, slug: 'acme', name: 'Acme' }, logs: 'hi' })
		);
		const text = textOf(await call('execute', { code: 'return 1' }));
		expect(deps.executions.start).toHaveBeenCalledWith({
			actor: { workspaceId: acme.id, userId: 'u1', role: 'member' },
			clientId: 'client-1',
			clientName: 'Test Client',
			ip: null,
			code: 'return 1'
		});
		expect(text.split('\n')[0]).toBe('Workspace: Acme (acme)');
		expect(text).toContain('"status": "completed"');
		expect(text).toContain('"logs": "hi"');
	});

	it('marks failures as tool errors', async () => {
		const { call, deps } = setup();
		deps.executions.start.mockResolvedValueOnce(
			outcome({ status: 'failed', result: undefined, error: { code: 'TYPE_ERROR', message: 'x' } })
		);
		const result = await call('execute', { code: 'oops' });
		expect('isError' in result && result.isError).toBe(true);
	});

	it('without elicitation returns the approval link and the pending status', async () => {
		const { call, deps } = setup();
		deps.executions.start.mockResolvedValueOnce(pendingApproval());
		const text = textOf(await call('execute', { code: 'x' }));
		expect(text).toContain('Status: awaiting_approval (execution exec-1)');
		expect(text).toContain('https://toolkien.test/approve/appr-1');
		expect(text).toContain('execution_status');
		expect(text).toMatch(/cannot approve it yourself/);
	});

	it('asks with an approval form, then answers it on the retry', async () => {
		const { call, deps } = setup();
		deps.executions.start.mockResolvedValueOnce(pendingApproval());
		const first = asInputRequired(await call('execute', { code: 'x' }, modernForm));
		const params = first.inputRequests!.approval.params as {
			message: string;
			requestedSchema: { properties: { decision: { oneOf: { const: string }[] } } };
		};
		expect(params.message).toContain('Connector: GitHub');
		expect(params.message).toContain('Tool: github.createIssue');
		expect(params.message).toContain('Workspace: Personal');
		expect(params.message).toContain('"title": "Bug"');
		expect(params.requestedSchema.properties.decision.oneOf.map((o) => o.const)).toEqual([
			'approve_once',
			'approve_tool',
			'reject'
		]);

		deps.executions.answerApproval.mockResolvedValueOnce(outcome());
		const second = await call(
			'execute',
			{ code: 'x' },
			{
				...modernForm,
				requestState: { kind: 'approval_form', executionId: 'exec-1', approvalId: 'appr-1' },
				inputResponses: { approval: { action: 'accept', content: { decision: 'approve_tool' } } }
			}
		);
		expect(deps.executions.answerApproval).toHaveBeenCalledWith({
			userId: 'u1',
			approvalId: 'appr-1',
			choice: 'approve_tool'
		});
		expect(deps.executions.start).toHaveBeenCalledTimes(1);
		expect(textOf(second)).toContain('"status": "completed"');
	});

	it('falls back to the link when the dialog is dismissed', async () => {
		const { call, deps } = setup();
		deps.executions.status.mockResolvedValueOnce(pendingApproval());
		const result = await call(
			'execute',
			{ code: 'x' },
			{
				...modernForm,
				requestState: { kind: 'approval_form', executionId: 'exec-1', approvalId: 'appr-1' },
				inputResponses: { approval: { action: 'cancel' } }
			}
		);
		expect(deps.executions.answerApproval).not.toHaveBeenCalled();
		expect(textOf(result)).toContain('https://toolkien.test/approve/appr-1');
	});

	it('asks again for a different pending approval after a URL round', async () => {
		const { call, deps } = setup();
		deps.executions.status.mockResolvedValueOnce(pendingApproval('appr-2'));
		const result = asInputRequired(
			await call(
				'execution_status',
				{ executionId: 'exec-1' },
				{
					...modernUrl,
					requestState: { kind: 'approval_url', executionId: 'exec-1', approvalId: 'appr-1' }
				}
			)
		);
		expect(deps.executions.status).toHaveBeenCalledWith({
			userId: 'u1',
			executionId: 'exec-1',
			resume: true
		});
		expect((result.inputRequests!.approval.params as { url: string }).url).toBe(
			'https://toolkien.test/approve/appr-2'
		);
	});
});

describe('execution_status', () => {
	it('resumes by default', async () => {
		const { call, deps } = setup();
		deps.executions.status.mockResolvedValueOnce(outcome());
		await call('execution_status', { executionId: 'exec-1' });
		expect(deps.executions.status).toHaveBeenCalledWith({
			userId: 'u1',
			executionId: 'exec-1',
			resume: true
		});
	});
});

describe('errors', () => {
	it('passes app error messages through and hides the rest', () => {
		let appError: unknown;
		try {
			error(404, 'Execution not found.', { code: 'NOT_FOUND' });
		} catch (cause) {
			appError = cause;
		}
		expect(textOf(errorResult('x', appError))).toBe('Execution not found.');
		expect(textOf(errorResult('x', new NotImplementedError('y')))).toMatch(/not available yet/);
		expect(textOf(errorResult('x', new Error('secret token abc')))).toBe(
			'Internal error. Try again later.'
		);
	});
});

describe('elicitationModes', () => {
	it('reads the declared modes', () => {
		expect(elicitationModes(undefined).elicitation).toEqual({ form: false, url: false });
		expect(elicitationModes({ elicitation: {} }).elicitation).toEqual({ form: true, url: false });
		expect(elicitationModes({ elicitation: { url: {} } }).elicitation).toEqual({
			form: false,
			url: true
		});
		expect(elicitationModes({ elicitation: { form: {}, url: {} } }).elicitation).toEqual({
			form: true,
			url: true
		});
	});
});
