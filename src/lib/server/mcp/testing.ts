/**
 * Test-only fakes for the MCP tools: a server that records registrations, an in-memory set of
 * contracts (`McpDeps`) and a configurable call environment.
 */
import { vi } from 'vitest';
import type { ServerContext } from '@modelcontextprotocol/server';
import type { ExecutionOutcome } from '#lib/server/executions/types.ts';
import type { EffectiveLevel } from '#lib/server/permissions/types.ts';
import type { WorkspaceSummary } from '#lib/server/workspaces/types.ts';
import type { McpDeps } from './deps.ts';
import type { RequestStatePayload } from './elicitation.ts';
import type { McpServerLike, ToolEnv, ToolResult } from './register.ts';

export type RegisteredTool = {
	config: Parameters<McpServerLike['registerTool']>[1];
	handler: (input: never, ctx: ServerContext) => Promise<ToolResult>;
};

export function fakeServer() {
	const tools = new Map<string, RegisteredTool>();
	const server: McpServerLike = {
		registerTool(name, config, handler) {
			tools.set(name, { config, handler });
		}
	};
	return { server, tools };
}

export const personal: WorkspaceSummary = {
	id: 'ws-personal',
	slug: 'personal-u1',
	name: 'Personal',
	kind: 'personal',
	role: 'owner',
	suspended: false,
	deleteScheduledAt: null
};

export const acme: WorkspaceSummary = {
	id: 'ws-acme',
	slug: 'acme',
	name: 'Acme',
	kind: 'company',
	role: 'member',
	suspended: false,
	deleteScheduledAt: null
};

const level = (value: EffectiveLevel['level']): EffectiveLevel => ({
	level: value,
	needsConfirmation: false,
	source: 'default'
});

/** Tools of the fake catalogue and their effective level */
export const catalogue: Record<string, { toolId: string; level: EffectiveLevel['level'] }> = {
	'github.listIssues': { toolId: 't1', level: 'allow' },
	'github.createIssue': { toolId: 't2', level: 'ask' },
	'github.deleteRepo': { toolId: 't3', level: 'block' }
};

export function fakeDeps(options: { active?: WorkspaceSummary } = {}) {
	let active = options.active ?? personal;
	const deps = {
		origin: 'https://toolkien.test',
		workspaces: {
			listForUser: vi.fn(async () => [personal, acme]),
			getById: vi.fn(
				async (_userId: string, id: string) => [personal, acme].find((w) => w.id === id) ?? null
			),
			getActiveWorkspace: vi.fn(async () => active),
			setActiveWorkspace: vi.fn(async (_userId: string, _clientId: string, id: string) => {
				active = [personal, acme].find((w) => w.id === id)!;
			})
		},
		connectors: {
			searchTools: vi.fn(async () =>
				Object.keys(catalogue).map((path) => ({
					path,
					summary: `Summary of ${path}`,
					connectorName: 'GitHub',
					unverified: false
				}))
			),
			describeTools: vi.fn(async (_actor, paths: string[]) =>
				paths.map((path) => ({ path, declaration: `declare function ${path}(): Promise<void>;` }))
			),
			resolveTool: vi.fn(async (_actor, path: string) =>
				catalogue[path] ? ({ toolId: catalogue[path].toolId, path } as never) : null
			)
		},
		permissions: {
			getEffectiveLevels: vi.fn(async (_ws: string, _user: string, ids: string[]) => {
				const map = new Map<string, EffectiveLevel>();
				for (const entry of Object.values(catalogue)) {
					if (ids.includes(entry.toolId)) map.set(entry.toolId, level(entry.level));
				}
				return map;
			})
		},
		executions: {
			start: vi.fn<McpDeps['executions']['start']>(),
			status: vi.fn<McpDeps['executions']['status']>(),
			answerApproval: vi.fn<McpDeps['executions']['answerApproval']>(),
			listPendingApprovals: vi.fn<McpDeps['executions']['listPendingApprovals']>(async () => [])
		},
		audit: { record: vi.fn(async () => {}) }
	} satisfies McpDeps;
	return deps;
}

export function fakeEnv(overrides: Partial<ToolEnv> = {}): ToolEnv {
	return {
		request: {
			userId: 'u1',
			clientId: 'client-1',
			clientName: 'Test Client',
			clientInfo: 'test-client 1.0.0',
			scopes: []
		},
		era: 'legacy',
		capabilities: { elicitation: { form: false, url: false } },
		inputResponses: undefined,
		requestState: undefined,
		mintState: async (payload: RequestStatePayload) => JSON.stringify(payload),
		...overrides
	};
}

export function outcome(overrides: Partial<ExecutionOutcome> = {}): ExecutionOutcome {
	return {
		executionId: 'exec-1',
		workspace: { id: personal.id, slug: personal.slug, name: personal.name },
		status: 'completed',
		result: { ok: true },
		...overrides
	};
}

export const pendingApproval = (approvalId = 'appr-1') =>
	outcome({
		status: 'awaiting_approval',
		result: undefined,
		approval: {
			approvalId,
			workspaceName: 'Personal',
			connectorName: 'GitHub',
			toolPath: 'github.createIssue',
			argumentsPreview: '{ "title": "Bug" }',
			approvalUrl: `https://toolkien.test/approve/${approvalId}`,
			expiresAt: new Date('2026-11-14T12:00:00Z')
		}
	});

/** Text of a final tool result */
export function textOf(result: ToolResult): string {
	if ('resultType' in result) throw new Error('Expected a final result, got input_required');
	return result.content.map((block) => ('text' in block ? block.text : '')).join('\n');
}
