/**
 * Live probe for the agent interface (opt-in: `TOOLKIEN_PROBE=1`, skipped otherwise).
 *
 * Serves the real `/mcp` handler on 127.0.0.1 so a real model (e.g. `claude -p --mcp-config`)
 * can be pointed at it. Real: MCP handler and the six tools, typegen, permissions, bridge,
 * durable executions, the Deno runner (local supervisor) and upstream calls to public MCP
 * servers (DeepWiki, Microsoft Learn) through `callUpstreamTool`. Faked: OAuth (a static bearer
 * token), workspaces, audit, crypto, and two in-process servers: `crm` (read, write → approval,
 * destructive → blocked) and `analytics` (PostHog-like insights, no output schema).
 *
 *   TOOLKIEN_PROBE=1 PROBE_OUT=/tmp/probe.json pnpm vitest run src/lib/server/mcp/live-probe.spec.ts
 *
 * `PROBE_OUT` receives `{ url, token, approveUrl }`. The human side of approvals is
 * `GET <approveUrl>/<approvalId>?decision=approve|approve_tool|reject`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { writeFileSync } from 'node:fs';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { createBridge } from '#lib/server/bridge/service.ts';
import { callUpstreamTool, toScriptValue } from '#lib/server/connectors/upstream.ts';
import type {
	ResolvedTool,
	ToolSearchHit,
	UpstreamCallResult
} from '#lib/server/connectors/types.ts';
import * as schema from '#lib/server/db/schema/index.ts';
import { createExecutionsService } from '#lib/server/executions/service.ts';
import {
	createTestDb,
	fakeCrypto,
	seedConnector,
	seedMember,
	seedUser,
	seedWorkspace
} from '#lib/server/executions/testing.ts';
import type { Limits } from '#lib/server/limits/types.ts';
import { createPermissionsService } from '#lib/server/permissions/service.ts';
import { createRunnerClient } from '#lib/server/runner/client.ts';
import { startLocalSupervisor } from '#lib/server/runner/local.ts';
import {
	functionNames,
	moduleDeclaration,
	signatureHash,
	toNamespace,
	type ToolTypeInput
} from '#lib/server/typegen/index.ts';
import type { WorkspaceSummary } from '#lib/server/workspaces/types.ts';
import type { McpDeps } from './deps.ts';
import { createHandleMcpRequest } from './handler.ts';

type McpTool = {
	name: string;
	title?: string;
	description?: string;
	inputSchema: Record<string, unknown>;
	outputSchema?: Record<string, unknown>;
	annotations?: Record<string, unknown>;
};

type Fake = (args: Record<string, unknown>) => UpstreamCallResult;

type Entry = ResolvedTool & {
	namespace: string;
	functionName: string;
	connectorName: string;
	tool: McpTool;
	url?: string;
	fake?: Fake;
};

const ok = (value: unknown): UpstreamCallResult => ({
	ok: true,
	content: [{ type: 'text', text: JSON.stringify(value) }]
});

const CONTACTS = [
	{ id: 'c1', name: 'Ada Lovelace', company: 'Analytical Engines', email: 'ada@engines.test' },
	{ id: 'c2', name: 'Grace Hopper', company: 'Navy', email: 'grace@navy.test' },
	{ id: 'c3', name: 'Alan Turing', company: 'Bletchley', email: 'alan@bletchley.test' }
];
const INSIGHTS = Array.from({ length: 30 }, (_, i) => ({
	id: 100 + i,
	short_id: `ins${i}`,
	name:
		['Weekly signups', 'Checkout funnel', 'Retention D7', 'Pageviews by country'][i % 4] + ` #${i}`,
	kind: ['trends', 'funnels', 'retention', 'trends'][i % 4],
	last_refresh: `2026-11-${String((i % 13) + 1).padStart(2, '0')}T10:00:00Z`,
	result_summary: { value: 1000 + i * 37, change_pct: (i % 7) - 3 }
}));

/** In-process servers with realistic schemas (and the shapes real servers have) */
const FAKES: Record<string, { name: string; tools: (McpTool & { run: Fake })[] }> = {
	crm: {
		name: 'CRM',
		tools: [
			{
				name: 'list_contacts',
				description: 'List contacts, optionally filtered by a search string.',
				inputSchema: {
					type: 'object',
					properties: {
						search: { type: 'string', description: 'Substring of name or company' },
						limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
					}
				},
				outputSchema: {
					type: 'object',
					properties: {
						contacts: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									id: { type: 'string' },
									name: { type: 'string' },
									company: { type: 'string' },
									email: { type: 'string', format: 'email' }
								},
								required: ['id', 'name']
							}
						}
					},
					required: ['contacts']
				},
				annotations: { readOnlyHint: true },
				run: (args) => {
					const q = String(args.search ?? '').toLowerCase();
					const contacts = CONTACTS.filter((c) =>
						`${c.name} ${c.company}`.toLowerCase().includes(q)
					).slice(0, Number(args.limit ?? 20));
					return { ok: true, structuredContent: { contacts }, content: [] };
				}
			},
			{
				name: 'add_note',
				description: 'Adds a note to a contact (visible to the whole sales team).',
				inputSchema: {
					type: 'object',
					properties: {
						contact_id: { type: 'string' },
						text: { type: 'string', minLength: 1, maxLength: 2000 },
						pinned: { type: 'boolean', default: false }
					},
					required: ['contact_id', 'text']
				},
				annotations: { readOnlyHint: false, destructiveHint: false },
				run: (args) =>
					CONTACTS.some((c) => c.id === args.contact_id)
						? ok({ noteId: `n-${randomUUID().slice(0, 8)}`, contactId: args.contact_id })
						: {
								ok: false,
								code: 'upstream_error',
								message: `Contact "${String(args.contact_id)}" does not exist.`
							}
			},
			{
				name: 'delete_contact',
				description: 'Permanently deletes a contact.',
				inputSchema: {
					type: 'object',
					properties: { contact_id: { type: 'string' } },
					required: ['contact_id']
				},
				annotations: { destructiveHint: true },
				run: () => ok({ deleted: true })
			}
		]
	},
	analytics: {
		name: 'Analytics',
		tools: [
			{
				name: 'insights-list',
				description:
					'List saved insights of the current project (trends, funnels, retention), newest first. Paginated with limit/offset.',
				inputSchema: {
					type: 'object',
					properties: {
						search: { type: 'string', description: 'Filter by name' },
						kind: { type: 'string', enum: ['trends', 'funnels', 'retention'] },
						limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
						offset: { type: 'integer', minimum: 0, default: 0 }
					}
				},
				annotations: { readOnlyHint: true },
				run: (args) => {
					const q = String(args.search ?? '').toLowerCase();
					const rows = INSIGHTS.filter(
						(i) => i.name.toLowerCase().includes(q) && (!args.kind || i.kind === args.kind)
					);
					const offset = Number(args.offset ?? 0);
					const limit = Number(args.limit ?? 10);
					return ok({
						count: rows.length,
						next: offset + limit < rows.length ? offset + limit : null,
						results: rows.slice(offset, offset + limit)
					});
				}
			},
			{
				name: 'insight-get',
				description: 'Get one insight with its latest computed result.',
				inputSchema: {
					type: 'object',
					properties: { id: { type: 'integer', description: 'Insight id' } },
					required: ['id']
				},
				annotations: { readOnlyHint: true },
				run: (args) => {
					const found = INSIGHTS.find((i) => i.id === args.id);
					return found
						? ok({ ...found, series: [3, 5, 8, 13, 21].map((v) => v * found.id) })
						: {
								ok: false,
								code: 'upstream_error',
								message: `Insight ${String(args.id)} not found.`
							};
				}
			}
		]
	}
};

const REAL: Record<string, { name: string; url: string }> = {
	deepwiki: { name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp' },
	microsoftLearn: { name: 'Microsoft Learn', url: 'https://learn.microsoft.com/api/mcp' }
};

async function listRemote(url: string): Promise<McpTool[]> {
	const client = new Client(
		{ name: 'toolkien-probe', version: '1.0.0' },
		{
			versionNegotiation: { mode: 'auto' },
			capabilities: {}
		}
	);
	await client.connect(new StreamableHTTPClientTransport(new URL(url)), { timeout: 20_000 });
	try {
		return (await client.listTools(undefined, { timeout: 20_000 })).tools as McpTool[];
	} finally {
		await client.close().catch(() => {});
	}
}

const readBody = (req: IncomingMessage) =>
	new Promise<Buffer>((resolve, reject) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});

describe.skipIf(!process.env.TOOLKIEN_PROBE)('live probe', () => {
	it('serves /mcp for a real agent', { timeout: 24 * 3600_000 }, async () => {
		const t = await createTestDb();
		const db = t.db;
		const user = await seedUser(db);
		const wsId = await seedWorkspace(db, { name: 'Probe Co', kind: 'company' });
		await seedMember(db, wsId, user, 'owner');
		const workspace: WorkspaceSummary = {
			id: wsId,
			slug: `ws-${wsId}`,
			name: 'Probe Co',
			kind: 'company',
			role: 'owner',
			suspended: false,
			deleteScheduledAt: null
		};

		// Connectors and tools, stored like a sync would (real schemas, real signature hashes)
		const entries: Entry[] = [];
		const add = async (key: string, name: string, tools: McpTool[], extra: Partial<Entry>[]) => {
			const namespace = toNamespace(key);
			const conn = await seedConnector(db, wsId, {
				namespace,
				name,
				source: 'directory',
				unverified: false
			});
			const names = functionNames(tools.map((tool) => tool.name));
			for (const [i, tool] of tools.entries()) {
				const toolId = randomUUID();
				const functionName = names.get(tool.name)!;
				const path = `${namespace}.${functionName}`;
				const annotations = (tool.annotations ?? null) as ResolvedTool['annotations'];
				const hash = signatureHash({
					inputSchema: tool.inputSchema,
					outputSchema: tool.outputSchema ?? null,
					annotations
				});
				await db.insert(schema.tool).values({
					id: toolId,
					workspaceId: wsId,
					connectorId: conn.id,
					upstreamName: tool.name,
					path,
					currentVersion: 1
				});
				await db.insert(schema.toolVersion).values({
					toolId,
					version: 1,
					title: tool.title ?? null,
					description: tool.description ?? null,
					inputSchema: tool.inputSchema,
					outputSchema: tool.outputSchema ?? null,
					annotations,
					signatureHash: hash
				});
				entries.push({
					toolId,
					path,
					connectorId: conn.id,
					workspaceId: wsId,
					upstreamName: tool.name,
					signatureHash: hash,
					annotations,
					source: 'directory',
					unverified: false,
					inputSchema: tool.inputSchema,
					outputSchema: tool.outputSchema ?? null,
					namespace,
					functionName,
					connectorName: name,
					tool,
					...extra[i]
				});
			}
		};
		for (const [key, server] of Object.entries(REAL)) {
			const tools = await listRemote(server.url);
			await add(
				key,
				server.name,
				tools,
				tools.map(() => ({ url: server.url }))
			);
		}
		for (const [key, server] of Object.entries(FAKES)) {
			await add(
				key,
				server.name,
				server.tools,
				server.tools.map((tool) => ({ fake: tool.run }))
			);
		}

		const audit = { record: async () => {} };
		const permissions = createPermissionsService({ db, audit });
		const deleteContact = entries.find((e) => e.path === 'crm.deleteContact')!;
		await permissions.setLevel({
			workspaceId: wsId,
			actorUserId: user,
			userId: null,
			toolId: deleteContact.toolId,
			level: 'block'
		});

		const toInput = (e: Entry): ToolTypeInput => ({
			path: e.path,
			namespace: e.namespace,
			functionName: e.functionName,
			title: e.tool.title ?? null,
			description: e.tool.description ?? null,
			inputSchema: e.tool.inputSchema,
			outputSchema: e.tool.outputSchema ?? null,
			annotations: e.annotations,
			unverified: false,
			connectorName: e.connectorName
		});
		const visible = async (rows: Entry[]) => {
			const ids = new Set(
				await permissions.visibleToolIds(
					wsId,
					user,
					rows.map((r) => r.toolId)
				)
			);
			return rows.filter((r) => ids.has(r.toolId));
		};
		const connectors = {
			async searchTools(_actor: unknown, query: string, limit = 20): Promise<ToolSearchHit[]> {
				const words = query
					.toLowerCase()
					.split(/\W+/)
					.filter((w) => w.length > 1);
				const scored = (await visible(entries))
					.map((e) => {
						const text =
							`${e.path} ${e.upstreamName} ${e.connectorName} ${e.tool.description ?? ''}`.toLowerCase();
						return { e, score: words.filter((w) => text.includes(w)).length };
					})
					.filter(({ score }) => score > 0 || words.length === 0)
					.sort((a, b) => b.score - a.score);
				return scored.slice(0, limit).map(({ e }) => ({
					path: e.path,
					summary: (e.tool.description ?? e.tool.title ?? '').split('\n')[0].slice(0, 160),
					connectorName: e.connectorName,
					unverified: false,
					namespace: e.namespace,
					accountHint: null
				}));
			},
			async describeTools(_actor: unknown, paths: string[]) {
				const rows = (await visible(entries)).filter((e) => paths.includes(e.path));
				const groups = new Map<string, Entry[]>();
				for (const row of rows)
					groups.set(row.namespace, [...(groups.get(row.namespace) ?? []), row]);
				const out = [];
				for (const row of rows) {
					const group = groups.get(row.namespace)!;
					out.push({
						path: row.path,
						declaration: group[0] === row ? await moduleDeclaration(group.map(toInput)) : '',
						connectorName: row.connectorName,
						namespace: row.namespace,
						accountHint: null
					});
				}
				return out;
			},
			async resolveTool(_actor: unknown, path: string) {
				return entries.find((e) => e.path === path) ?? null;
			},
			async callTool(_actor: unknown, tool: ResolvedTool, args: unknown) {
				const entry = entries.find((e) => e.toolId === tool.toolId)!;
				if (entry.fake) return entry.fake((args ?? {}) as Record<string, unknown>);
				return callUpstreamTool(
					{ url: entry.url!, credential: null },
					{
						name: entry.upstreamName,
						inputSchema: entry.inputSchema,
						outputSchema: entry.outputSchema
					},
					args
				);
			},
			async declarationsFor(_actor: unknown, toolIds: string[]) {
				return moduleDeclaration(
					(await visible(entries)).filter((e) => toolIds.includes(e.toolId)).map(toInput)
				);
			}
		};

		const limits: Limits = {
			execTimeoutMs: 120_000,
			execMaxToolCalls: 200,
			execMaxOutputBytes: 100 * 1024,
			rateLimitExecPerMin: 60,
			maxConcurrentPerUser: 4,
			maxConcurrentGlobal: 8
		};
		const limitsFake = {
			getLimits: async () => limits,
			checkRateLimit: () => ({ allowed: true as const }),
			acquireExecutionSlot: async () => () => {},
			assertNotSuspended: async () => {}
		};
		const bridge = createBridge({
			db,
			connectors,
			permissions,
			crypto: fakeCrypto,
			audit,
			limits: limitsFake,
			toScriptValue
		});
		const supervisor = await startLocalSupervisor();
		const runner = createRunnerClient(supervisor);

		const server = createServer();
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		const port = (server.address() as { port: number }).port;
		const origin = `http://127.0.0.1:${port}`;

		const executions = createExecutionsService({
			db,
			runner,
			handleToolCall: bridge,
			connectors,
			permissions,
			crypto: fakeCrypto,
			audit,
			limits: limitsFake,
			workspaces: { getById: async () => workspace },
			origin,
			softWaitMs: Number(process.env.PROBE_SOFT_WAIT_MS ?? 45_000)
		});
		const deps: McpDeps = {
			workspaces: {
				listForUser: async () => [workspace],
				getById: async () => workspace,
				getActiveWorkspace: async () => workspace,
				setActiveWorkspace: async () => {}
			},
			connectors,
			permissions,
			executions,
			audit,
			origin
		};
		const handle = createHandleMcpRequest({
			deps,
			stateKey: randomBytes(32),
			onerror: (error) => console.error(`[probe] ${error.name}: ${error.message}`)
		});
		const token = randomBytes(24).toString('hex');

		server.on('request', async (req, res) => {
			try {
				const url = new URL(req.url ?? '/', origin);
				const approve = /^\/approve\/([\w-]+)$/.exec(url.pathname);
				if (approve) {
					const decision = url.searchParams.get('decision') ?? 'approve';
					await executions.decideApproval({
						approvalId: approve[1],
						deciderUserId: user,
						decision:
							decision === 'reject'
								? { decision: 'reject' }
								: {
										decision: 'approve',
										scope: decision === 'approve_tool' ? 'tool_in_script' : 'once'
									}
					});
					res.writeHead(200).end(`decided: ${decision}\n`);
					return;
				}
				if (url.pathname !== '/mcp') return void res.writeHead(404).end();
				if (req.headers.authorization !== `Bearer ${token}`) return void res.writeHead(401).end();
				const body = req.method === 'POST' ? new Uint8Array(await readBody(req)) : undefined;
				const headers = new Headers();
				for (const [key, value] of Object.entries(req.headers)) {
					if (typeof value === 'string') headers.set(key, value);
				}
				const response = await handle(
					new Request(`${origin}/mcp`, { method: req.method, headers, body }),
					{
						userId: user,
						clientId: 'probe-client',
						connectionId: 'probe-connection',
						clientName: 'Probe agent',
						scopes: []
					}
				);
				res.writeHead(response.status, Object.fromEntries(response.headers));
				res.end(Buffer.from(await response.arrayBuffer()));
			} catch (error) {
				console.error('[probe] request failed', error);
				if (!res.headersSent) res.writeHead(500);
				res.end();
			}
		});

		const info = { url: `${origin}/mcp`, token, approveUrl: `${origin}/approve` };
		if (process.env.PROBE_OUT) writeFileSync(process.env.PROBE_OUT, JSON.stringify(info));
		console.info(
			`[probe] listening ${JSON.stringify({ ...info, token: '<in PROBE_OUT>' })}, ${entries.length} tools`
		);
		expect(entries.length).toBeGreaterThan(5);
		await new Promise((resolve) => setTimeout(resolve, Number(process.env.PROBE_MS ?? 3600_000)));
		server.close();
		await supervisor.stop();
		t.cleanup();
	});
});
