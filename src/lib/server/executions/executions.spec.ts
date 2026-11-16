import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridge } from '#lib/server/bridge/service.ts';
import type { ResolvedTool, UpstreamCallResult } from '#lib/server/connectors/types.ts';
import type { Db } from '#lib/server/db/index.ts';
import {
	approval,
	auditEvent,
	execution,
	executionCall,
	member,
	organization
} from '#lib/server/db/schema/index.ts';
import type { Limits } from '#lib/server/limits/types.ts';
import { createPermissionsService } from '#lib/server/permissions/service.ts';
import type { RunnerClient, RunnerResult } from '#lib/server/runner/types.ts';
import type { WorkspaceRole } from '#lib/server/workspaces/types.ts';
import { createExecutionsService } from './service.ts';
import {
	createTestDb,
	fakeCrypto,
	seedConnector,
	seedMember,
	seedTool,
	seedUser,
	seedWorkspace,
	type TestDb
} from './testing.ts';

// ─── Fakes ────────────────────────────────────────────────────────────────────

type Call = (path: string, args?: unknown) => Promise<unknown>;
type Program = (call: Call, log: (line: string) => void) => Promise<unknown>;

/** Mock runner: `code` names a program; every call goes through `onToolCall` like the real one */
function mockRunner(programs: Record<string, Program>) {
	const runs: string[] = [];
	const runner: Pick<RunnerClient, 'run'> = {
		async run(job, onToolCall): Promise<RunnerResult> {
			runs.push(job.executionId);
			const program = programs[job.code];
			if (!program) return { status: 'failed', code: 'type_error', message: 'nope', logs: '' };
			let seq = 0;
			let pausedAt = 0;
			let logs = '';
			const call: Call = async (path, args) => {
				const current = ++seq;
				const response = await onToolCall({ seq: current, path, args });
				if (response.kind === 'pause') {
					pausedAt = current;
					throw new Error('paused');
				}
				if (response.kind === 'error') {
					throw Object.assign(new Error(response.message), { code: response.code });
				}
				// The sandbox wraps text results as `ToolTextResult`; the fake keeps the marker visible
				return response.text ? { textResult: response.value } : response.value;
			};
			try {
				const result = await program(call, (line) => (logs += `${line}\n`));
				if (pausedAt) return { status: 'paused', atSeq: pausedAt, logs };
				return { status: 'completed', result, logs, truncated: false };
			} catch (e) {
				if (pausedAt) return { status: 'paused', atSeq: pausedAt, logs };
				return { status: 'failed', code: 'runtime_error', message: (e as Error).message, logs };
			}
		}
	};
	return { runner, runs };
}

/** Fake upstream: records every call (the "side effects") */
function fakeConnectors(getTools: () => ResolvedTool[]) {
	const upstream: { path: string; args: unknown }[] = [];
	let failWith: UpstreamCallResult | null = null;
	return {
		upstream,
		failNext(result: UpstreamCallResult) {
			failWith = result;
		},
		resolveTool: vi.fn(async (actor: { workspaceId: string }, path: string) => {
			return getTools().find((t) => t.path === path && t.workspaceId === actor.workspaceId) ?? null;
		}),
		callTool: vi.fn(async (_actor: unknown, tool: ResolvedTool, args: unknown) => {
			if (failWith) {
				const result = failWith;
				failWith = null;
				return result;
			}
			upstream.push({ path: tool.path, args });
			return {
				ok: true as const,
				structuredContent: { ok: tool.path, n: upstream.length },
				content: []
			};
		}),
		describeTools: vi.fn(async (_actor: unknown, paths: string[]) =>
			paths.map((path) => ({
				path,
				declaration: `function ${path}(input: { v2: string }): unknown`
			}))
		),
		declarationsFor: vi.fn(async () => 'declare const gh: Record<string, Function>;')
	};
}

const LIMITS: Limits = {
	execTimeoutMs: 5_000,
	execMaxToolCalls: 200,
	execMaxOutputBytes: 2_000,
	rateLimitExecPerMin: 1_000,
	maxConcurrentPerUser: 4,
	maxConcurrentGlobal: 32
};

// ─── Fixture ──────────────────────────────────────────────────────────────────

let t: TestDb;
let nowMs: number;
let ws: string;
let otherWs: string;
let user: string;
let admin: string;
let peer: string;
let tools: ResolvedTool[];
let suspended: boolean;
let limits: Limits;

const SECRET = 'top-secret-argument-value';

function makeSystem(
	db: Db,
	programs: Record<string, Program>,
	extra: { softWaitMs?: number } = {}
) {
	const audit = { record: vi.fn(async () => {}) };
	const connectors = fakeConnectors(() => tools);
	const { runner, runs } = mockRunner(programs);
	const permissions = createPermissionsService({ db, audit });
	const now = () => new Date(nowMs);
	const limitsFake = {
		getLimits: async () => limits,
		checkRateLimit: () => ({ allowed: true as const }),
		acquireExecutionSlot: vi.fn(async () => () => {}),
		assertNotSuspended: async () => {
			if (suspended) throw new Error('suspended');
		}
	};
	const bridge = createBridge({
		db,
		connectors,
		permissions,
		crypto: fakeCrypto,
		audit,
		limits: limitsFake,
		now
	});
	const service = createExecutionsService({
		db,
		runner,
		handleToolCall: bridge,
		connectors,
		permissions,
		crypto: fakeCrypto,
		audit,
		limits: limitsFake,
		workspaces: {
			getById: async (userId, workspaceId) => {
				const [row] = await db
					.select({ role: member.role, name: organization.name, slug: organization.slug })
					.from(member)
					.innerJoin(organization, eq(organization.id, member.organizationId))
					.where(and(eq(member.userId, userId), eq(member.organizationId, workspaceId)));
				return row
					? {
							id: workspaceId,
							slug: row.slug,
							name: row.name,
							kind: 'company',
							role: row.role as WorkspaceRole,
							suspended: false,
							deleteScheduledAt: null
						}
					: null;
			}
		},
		origin: 'https://toolkien.test',
		now,
		...extra
	});
	return { service, bridge, connectors, audit, runs, permissions, runner };
}

async function seedResolved(
	db: Db,
	workspaceId: string,
	connectorId: string,
	path: string,
	annotations: ResolvedTool['annotations']
): Promise<ResolvedTool> {
	const toolId = await seedTool(db, workspaceId, connectorId, { path, annotations });
	return {
		toolId,
		path,
		connectorId,
		workspaceId,
		upstreamName: path.split('.')[1],
		signatureHash: 'sig-1',
		annotations,
		source: 'directory',
		unverified: false,
		inputSchema: { type: 'object' },
		// Structured results (the fake upstream answers `structuredContent`); text tools set null
		outputSchema: { type: 'object' }
	};
}

beforeEach(async () => {
	t = await createTestDb();
	nowMs = Date.now();
	suspended = false;
	limits = { ...LIMITS };
	ws = await seedWorkspace(t.db, { name: 'Acme' });
	otherWs = await seedWorkspace(t.db, { name: 'Other' });
	user = await seedUser(t.db);
	admin = await seedUser(t.db);
	peer = await seedUser(t.db);
	await seedMember(t.db, ws, user, 'member');
	await seedMember(t.db, ws, admin, 'admin');
	await seedMember(t.db, ws, peer, 'member');
	await seedMember(t.db, otherWs, user, 'owner');
	const gh = await seedConnector(t.db, ws, { namespace: 'gh', name: 'GitHub' });
	const foreign = await seedConnector(t.db, otherWs, { namespace: 'gh', name: 'GitHub (other)' });
	tools = [
		await seedResolved(t.db, ws, gh.id, 'gh.listIssues', { readOnlyHint: true }),
		await seedResolved(t.db, ws, gh.id, 'gh.createIssue', { readOnlyHint: false }),
		await seedResolved(t.db, ws, gh.id, 'gh.deleteRepo', { destructiveHint: true }),
		await seedResolved(t.db, otherWs, foreign.id, 'gh.listIssues', { readOnlyHint: true })
	];
});

afterEach(() => t.cleanup());

const actor = () => ({ workspaceId: ws, userId: user, role: 'member' as const });

async function executionRow(db: Db, id: string) {
	const [row] = await db.select().from(execution).where(eq(execution.id, id));
	return row;
}

async function contentLeft(db: Db, id: string) {
	const [exec] = await db.select().from(execution).where(eq(execution.id, id));
	const calls = await db.select().from(executionCall).where(eq(executionCall.executionId, id));
	const approvals = await db.select().from(approval).where(eq(approval.executionId, id));
	return (
		(exec.stateCiphertext ? 1 : 0) +
		calls.filter((c) => c.resultCiphertext).length +
		approvals.filter((a) => a.previewCiphertext).length
	);
}

const PROGRAMS: Record<string, Program> = {
	read: async (call) => call('gh.listIssues', { repo: 'a/b' }),
	readThenWrite: async (call, log) => {
		const issues = await call('gh.listIssues', { repo: 'a/b' });
		log('listed');
		const created = await call('gh.createIssue', { repo: 'a/b', title: SECRET });
		return { issues, created };
	},
	writeThreeTimes: async (call) => {
		const out = [];
		for (let i = 0; i < 3; i++) out.push(await call('gh.createIssue', { title: `t${i}` }));
		return out;
	},
	twoWrites: async (call) => {
		await call('gh.createIssue', { title: 'first' });
		await call('gh.deleteRepo', { repo: 'a/b' });
		return 'done';
	},
	catchRejection: async (call) => {
		try {
			await call('gh.createIssue', { title: 'x' });
			return 'created';
		} catch (e) {
			return `caught:${(e as { code?: string }).code}`;
		}
	},
	bigOutput: async (_call, log) => {
		log('x'.repeat(5000));
		return 'y'.repeat(5000);
	},
	manyReads: async (call) => {
		for (let i = 0; i < 3; i++) await call('gh.listIssues', { page: i });
		return 'ok';
	},
	deleteRepo: async (call) => call('gh.deleteRepo', { repo: 'a/b' }),
	protoKeys: async (call) =>
		call(
			'gh.listIssues',
			JSON.parse(
				'{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"repo":"a/b"}'
			)
		),
	slowRead: async (call, log) => {
		await new Promise((resolve) => setTimeout(resolve, 150));
		log('still here');
		return call('gh.listIssues', { repo: 'a/b' });
	},
	slowFailure: async () => {
		await new Promise((resolve) => setTimeout(resolve, 150));
		throw new Error('boom after a while');
	}
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('hostile arguments', () => {
	it('passes __proto__ / constructor keys through as data, never polluting the app', async () => {
		const { service, connectors } = makeSystem(t.db, PROGRAMS);
		const outcome = await service.start({ actor: actor(), clientId: 'claude', code: 'protoKeys' });
		expect(outcome.status).toBe('completed');
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(Object.prototype).not.toHaveProperty('polluted');
		const sent = connectors.upstream[0].args as Record<string, unknown>;
		expect(Object.hasOwn(sent, '__proto__')).toBe(true);
		expect(Object.getPrototypeOf(sent)).toBe(Object.prototype);
		expect(sent.repo).toBe('a/b');
	});
});

describe('long runs (soft wait)', () => {
	it('answers running past the soft wait, then hands the result to execution_status', async () => {
		const { service } = makeSystem(t.db, PROGRAMS, { softWaitMs: 20 });
		const started = await service.start({ actor: actor(), clientId: 'claude', code: 'slowRead' });
		expect(started).toMatchObject({ status: 'running', workspace: { id: ws, name: 'Acme' } });
		expect(started.result).toBeUndefined();

		// Still running: status waits again (briefly), then reports running
		const meanwhile = await service.status({
			userId: user,
			executionId: started.executionId,
			resume: true
		});
		expect(['running', 'completed']).toContain(meanwhile.status);

		await new Promise((resolve) => setTimeout(resolve, 250));
		const done = await service.status({
			userId: user,
			executionId: started.executionId,
			resume: true
		});
		expect(done).toMatchObject({
			status: 'completed',
			result: { ok: 'gh.listIssues', n: 1 },
			logs: 'still here\n'
		});
		// Content is still wiped from the database: the result lived only in memory
		expect(await contentLeft(t.db, started.executionId)).toBe(0);
		// Other users cannot collect it
		await expect(
			service.status({ userId: peer, executionId: started.executionId, resume: true })
		).rejects.toMatchObject({ status: 404 });
	});

	it('keeps the failure message of a long run for execution_status', async () => {
		const { service } = makeSystem(t.db, PROGRAMS, { softWaitMs: 20 });
		const started = await service.start({
			actor: actor(),
			clientId: 'claude',
			code: 'slowFailure'
		});
		expect(started.status).toBe('running');
		await new Promise((resolve) => setTimeout(resolve, 250));
		const done = await service.status({
			userId: user,
			executionId: started.executionId,
			resume: false
		});
		expect(done).toMatchObject({
			status: 'failed',
			error: { code: 'runtime_error', message: 'boom after a while' }
		});
	});

	it('returns quick runs directly', async () => {
		const { service } = makeSystem(t.db, PROGRAMS, { softWaitMs: 5_000 });
		const outcome = await service.start({ actor: actor(), clientId: 'claude', code: 'read' });
		expect(outcome.status).toBe('completed');
	});
});

describe('executions + bridge', () => {
	it('hands results of tools without an output schema over as text blocks, verbatim', async () => {
		tools = tools.map((t) =>
			t.path === 'gh.listIssues' && t.workspaceId === ws ? { ...t, outputSchema: null } : t
		);
		const { service, connectors } = makeSystem(t.db, PROGRAMS);
		const content = [
			{ type: 'text', text: 'Name: example.com' },
			{ type: 'text', text: 'Status: verified' }
		];
		connectors.failNext({ ok: true, content });
		const outcome = await service.start({ actor: actor(), clientId: 'claude', code: 'read' });
		expect(outcome.status).toBe('completed');
		// Nothing parsed or dropped: the sandbox builds `ToolTextResult` (`text`, `json()`) from it
		expect(outcome.result).toEqual({ textResult: { content } });
	});

	it('runs read-only calls without approval and wipes content at the end', async () => {
		const { service, connectors, audit } = makeSystem(t.db, PROGRAMS);
		const outcome = await service.start({ actor: actor(), clientId: 'claude', code: 'read' });
		expect(outcome.status).toBe('completed');
		expect(outcome.workspace).toMatchObject({ id: ws, name: 'Acme' });
		expect(outcome.result).toEqual({ ok: 'gh.listIssues', n: 1 });
		expect(connectors.upstream).toHaveLength(1);
		expect(await contentLeft(t.db, outcome.executionId)).toBe(0);
		expect(await executionRow(t.db, outcome.executionId)).toMatchObject({
			status: 'completed',
			toolCallCount: 1
		});
		const types = audit.record.mock.calls.map((c) => (c as unknown as [{ type: string }])[0].type);
		expect(types).toEqual(['execution.started', 'tool.called', 'execution.completed']);
	});

	it('pauses on a write, survives a restart, resumes with cached reads and writes once', async () => {
		const first = makeSystem(t.db, PROGRAMS);
		const paused = await first.service.start({
			actor: actor(),
			clientId: 'claude',
			code: 'readThenWrite'
		});
		expect(paused.status).toBe('awaiting_approval');
		expect(paused.approval).toMatchObject({
			workspaceName: 'Acme',
			connectorName: 'GitHub',
			toolPath: 'gh.createIssue'
		});
		expect(paused.approval!.argumentsPreview).toContain(SECRET);
		expect(paused.approval!.approvalUrl).toBe(
			`https://toolkien.test/approve/${paused.approval!.approvalId}`
		);
		expect(first.connectors.upstream.map((c) => c.path)).toEqual(['gh.listIssues']);

		// Durable state is sealed in the database; nothing in plaintext
		const row = await executionRow(t.db, paused.executionId);
		expect(row.status).toBe('paused');
		expect(row.stateCiphertext).toBeTruthy();
		expect(Buffer.from(row.stateCiphertext!).toString()).not.toContain('readThenWrite');
		const pendingRows = await t.db.select().from(approval);
		expect(Buffer.from(pendingRows[0].previewCiphertext!).toString()).not.toContain(SECRET);

		// "Restart": a new process with fresh memory and a new database connection
		const second = makeSystem(t.reopen(), PROGRAMS);
		expect(await second.service.listPendingApprovals(user)).toHaveLength(1);
		const notYet = await second.service.status({
			userId: user,
			executionId: paused.executionId,
			resume: true
		});
		expect(notYet.status).toBe('awaiting_approval');

		await second.service.decideApproval({
			approvalId: paused.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'approve', scope: 'once' }
		});
		const done = await second.service.status({
			userId: user,
			executionId: paused.executionId,
			resume: true
		});
		expect(done.status).toBe('completed');
		expect(done.result).toEqual({
			issues: { ok: 'gh.listIssues', n: 1 },
			created: { ok: 'gh.createIssue', n: 1 }
		});
		// The read was replayed from cache, not repeated
		expect(second.connectors.upstream.map((c) => c.path)).toEqual(['gh.createIssue']);
		expect(await contentLeft(t.db, paused.executionId)).toBe(0);

		// Audit metadata never carries arguments or results
		const audits = JSON.stringify([
			...first.audit.record.mock.calls,
			...second.audit.record.mock.calls
		]);
		expect(audits).not.toContain(SECRET);
		expect(audits).not.toContain('a/b');
		expect(JSON.stringify(await t.db.select().from(auditEvent))).not.toContain(SECRET);
	});

	it('never repeats a completed write across several pauses', async () => {
		const { service, connectors, permissions } = makeSystem(t.db, PROGRAMS);
		const createIssue = tools.find((x) => x.path === 'gh.createIssue')!;
		await permissions.setLevel({
			workspaceId: ws,
			actorUserId: user,
			userId: user,
			toolId: createIssue.toolId,
			level: 'allow'
		});
		const paused = await service.start({ actor: actor(), clientId: null, code: 'twoWrites' });
		expect(paused.approval?.toolPath).toBe('gh.deleteRepo');
		expect(connectors.upstream.map((c) => c.path)).toEqual(['gh.createIssue']);

		await service.decideApproval({
			approvalId: paused.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'approve', scope: 'once' }
		});
		const done = await service.status({
			userId: user,
			executionId: paused.executionId,
			resume: true
		});
		expect(done.status).toBe('completed');
		expect(connectors.upstream.map((c) => c.path)).toEqual(['gh.createIssue', 'gh.deleteRepo']);
	});

	it('"approve all for this tool in this script" covers later calls; "once" does not', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const first = await sys.service.start({
			actor: actor(),
			clientId: null,
			code: 'writeThreeTimes'
		});
		await sys.service.decideApproval({
			approvalId: first.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'approve', scope: 'tool_in_script' }
		});
		const done = await sys.service.status({
			userId: user,
			executionId: first.executionId,
			resume: true
		});
		expect(done.status).toBe('completed');
		expect(sys.connectors.upstream).toHaveLength(3);

		const second = await sys.service.start({
			actor: actor(),
			clientId: null,
			code: 'writeThreeTimes'
		});
		await sys.service.decideApproval({
			approvalId: second.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'approve', scope: 'once' }
		});
		const again = await sys.service.status({
			userId: user,
			executionId: second.executionId,
			resume: true
		});
		expect(again.status).toBe('awaiting_approval');
		expect(again.approval!.approvalId).not.toBe(second.approval!.approvalId);
		expect(sys.connectors.upstream).toHaveLength(4);
		// The approval of the first script does not leak into the second one
		expect(sys.connectors.upstream.slice(3).map((c) => c.args)).toEqual([{ title: 't0' }]);
	});

	it('an "approve once" is bound to the exact arguments the human saw', async () => {
		let attempt = 0;
		const sys = makeSystem(t.db, {
			drifting: async (call) => call('gh.createIssue', { title: `run-${attempt++}` })
		});
		const paused = await sys.service.start({ actor: actor(), clientId: null, code: 'drifting' });
		await sys.service.decideApproval({
			approvalId: paused.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'approve', scope: 'once' }
		});
		const resumed = await sys.service.status({
			userId: user,
			executionId: paused.executionId,
			resume: true
		});
		expect(resumed.status).toBe('awaiting_approval');
		expect(sys.connectors.upstream).toHaveLength(0);
	});

	it('rejection: the call throws in the script and nothing reaches upstream', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const paused = await sys.service.start({
			actor: actor(),
			clientId: null,
			code: 'catchRejection'
		});
		await sys.service.decideApproval({
			approvalId: paused.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'reject' }
		});
		const done = await sys.service.status({
			userId: user,
			executionId: paused.executionId,
			resume: true
		});
		expect(done).toMatchObject({ status: 'completed', result: 'caught:approval_rejected' });
		expect(sys.connectors.upstream).toHaveLength(0);
		const [row] = await t.db.select().from(approval);
		expect(row).toMatchObject({ status: 'rejected', decidedBy: user });
	});

	it('expires unanswered approvals after 30 minutes and wipes the state', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const paused = await sys.service.start({
			actor: actor(),
			clientId: null,
			code: 'readThenWrite'
		});
		nowMs += 29 * 60 * 1000;
		expect(await sys.service.expireStale()).toEqual({ approvals: 0, executions: 0 });
		nowMs += 2 * 60 * 1000;
		expect(await sys.service.expireStale()).toEqual({ approvals: 1, executions: 1 });
		expect(await contentLeft(t.db, paused.executionId)).toBe(0);
		const outcome = await sys.service.status({
			userId: user,
			executionId: paused.executionId,
			resume: true
		});
		expect(outcome).toMatchObject({ status: 'failed', error: { code: 'expired' } });
		await expect(
			sys.service.decideApproval({
				approvalId: paused.approval!.approvalId,
				deciderUserId: user,
				decision: { decision: 'approve', scope: 'once' }
			})
		).rejects.toMatchObject({ status: 409 });
		expect(await sys.service.listPendingApprovals(user)).toHaveLength(0);
	});

	it('only the execution user or a workspace admin can see and decide an approval', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const paused = await sys.service.start({ actor: actor(), clientId: null, code: 'deleteRepo' });
		const approvalId = paused.approval!.approvalId;
		await expect(sys.service.getApproval({ approvalId, viewerUserId: peer })).rejects.toMatchObject(
			{ status: 404 }
		);
		await expect(
			sys.service.decideApproval({
				approvalId,
				deciderUserId: peer,
				decision: { decision: 'approve', scope: 'once' }
			})
		).rejects.toMatchObject({ status: 404 });
		const view = await sys.service.getApproval({ approvalId, viewerUserId: admin });
		expect(view).toMatchObject({
			canDecide: true,
			onBehalfOfOtherUser: true,
			toolPath: 'gh.deleteRepo'
		});
		await sys.service.decideApproval({
			approvalId,
			deciderUserId: admin,
			decision: { decision: 'approve', scope: 'once' }
		});
		await expect(
			sys.service.decideApproval({
				approvalId,
				deciderUserId: user,
				decision: { decision: 'reject' }
			})
		).rejects.toMatchObject({ status: 409 });
		// Other users cannot read or resume the execution
		await expect(
			sys.service.status({ userId: admin, executionId: paused.executionId, resume: true })
		).rejects.toMatchObject({ status: 404 });
		const done = await sys.service.status({
			userId: user,
			executionId: paused.executionId,
			resume: true
		});
		expect(done.status).toBe('completed');
		const decided = sys.audit.record.mock.calls
			.map((c) => (c as unknown as [{ type: string; approvedBy?: string }])[0])
			.find((e) => e.type === 'approval.decided');
		expect(decided?.approvedBy).toBe('admin');
	});

	it('elicitation answers decide and resume in one step', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const paused = await sys.service.start({
			actor: actor(),
			clientId: 'claude',
			code: 'deleteRepo'
		});
		await expect(
			sys.service.answerApproval({
				userId: admin,
				approvalId: paused.approval!.approvalId,
				choice: 'approve_once'
			})
		).rejects.toMatchObject({ status: 404 });
		const done = await sys.service.answerApproval({
			userId: user,
			approvalId: paused.approval!.approvalId,
			choice: 'approve_once'
		});
		expect(done.status).toBe('completed');
		const [row] = await t.db.select().from(approval);
		expect(row.channel).toBe('elicitation');
	});

	it('concurrent resumes run the script once', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const paused = await sys.service.start({ actor: actor(), clientId: null, code: 'deleteRepo' });
		await sys.service.decideApproval({
			approvalId: paused.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'approve', scope: 'once' }
		});
		const input = { userId: user, executionId: paused.executionId, resume: true };
		await Promise.all([
			sys.service.status(input),
			sys.service.status(input),
			sys.service.status(input)
		]);
		expect(sys.connectors.upstream).toHaveLength(1);
		expect(sys.runs).toHaveLength(2);
	});

	it('blocked tools fail without reaching upstream and are hidden from declarations', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const deleteRepo = tools.find((x) => x.path === 'gh.deleteRepo')!;
		await sys.permissions.setLevel({
			workspaceId: ws,
			actorUserId: user,
			userId: user,
			toolId: deleteRepo.toolId,
			level: 'block'
		});
		const outcome = await sys.service.start({ actor: actor(), clientId: null, code: 'deleteRepo' });
		expect(outcome).toMatchObject({ status: 'failed', error: { code: 'runtime_error' } });
		expect(outcome.error!.message).toContain('blocked');
		expect(sys.connectors.upstream).toHaveLength(0);
		const ids = (sys.connectors.declarationsFor.mock.calls[0] as unknown as [unknown, string[]])[1];
		expect(ids).not.toContain(deleteRepo.toolId);
		expect(ids).toHaveLength(2);
	});

	it('passes checker warnings on, for completed and failed runs', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const warnings = 'Warning: line 1 casts to `any`: type checks were skipped there.';
		vi.spyOn(sys.runner, 'run')
			.mockResolvedValueOnce({
				status: 'completed',
				result: 1,
				logs: '',
				truncated: false,
				warnings
			})
			.mockResolvedValueOnce({
				status: 'failed',
				code: 'runtime_error',
				message: 'TypeError',
				logs: '',
				warnings
			});
		const start = () => sys.service.start({ actor: actor(), clientId: null, code: 'x' });
		expect(await start()).toMatchObject({ status: 'completed', result: 1, warnings });
		expect(await start()).toMatchObject({ status: 'failed', warnings });
	});

	it('truncates large output with an explicit notice', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const outcome = await sys.service.start({ actor: actor(), clientId: null, code: 'bigOutput' });
		expect(outcome.truncated).toBe(true);
		expect(outcome.logs).toContain('Output truncated at 2000 bytes');
		expect(
			Buffer.byteLength(JSON.stringify(outcome.result)) + Buffer.byteLength(outcome.logs!)
		).toBeLessThanOrEqual(2_000 + 2);
	});

	it('enforces the tool call limit in the bridge', async () => {
		limits = { ...LIMITS, execMaxToolCalls: 2 };
		const sys = makeSystem(t.db, PROGRAMS);
		const outcome = await sys.service.start({ actor: actor(), clientId: null, code: 'manyReads' });
		expect(outcome.status).toBe('failed');
		expect(outcome.error!.message).toContain('Too many tool calls');
		expect(sys.connectors.upstream).toHaveLength(2);
	});

	it('kill switch: calls fail while suspended', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const paused = await sys.service.start({ actor: actor(), clientId: null, code: 'deleteRepo' });
		await sys.service.decideApproval({
			approvalId: paused.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'approve', scope: 'once' }
		});
		suspended = true;
		const outcome = await sys.service.status({
			userId: user,
			executionId: paused.executionId,
			resume: true
		});
		expect(outcome).toMatchObject({ status: 'failed', error: { code: 'suspended' } });
		expect(sys.connectors.upstream).toHaveLength(0);
		expect(await contentLeft(t.db, paused.executionId)).toBe(0);
	});

	it('cancel stops a paused execution and wipes it', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const paused = await sys.service.start({ actor: actor(), clientId: null, code: 'deleteRepo' });
		await expect(
			sys.service.cancel({ userId: peer, executionId: paused.executionId })
		).rejects.toMatchObject({ status: 404 });
		await sys.service.cancel({ userId: user, executionId: paused.executionId });
		expect((await executionRow(t.db, paused.executionId)).status).toBe('cancelled');
		expect(await contentLeft(t.db, paused.executionId)).toBe(0);
		const [row] = await t.db.select().from(approval);
		expect(row.status).toBe('expired');
	});

	it('maps unknown-tool / invalid-params errors to the refreshed signature', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		sys.connectors.failNext({ ok: false, code: 'invalid_params', message: 'bad input' });
		const outcome = await sys.service.start({ actor: actor(), clientId: null, code: 'read' });
		expect(outcome.status).toBe('failed');
		expect(outcome.error!.message).toContain('bad input');
		expect(outcome.error!.message).toContain('function gh.listIssues(input: { v2: string })');
	});
});

describe('bridge guards', () => {
	async function runningExecution(db: Db, workspaceId = ws) {
		const [row] = await db
			.insert(execution)
			.values({ workspaceId, userId: user, status: 'running', codeHash: 'x' })
			.returning();
		return row;
	}

	it('rejects a path that resolves to another workspace', async () => {
		const sys = makeSystem(t.db, {});
		const exec = await runningExecution(t.db);
		const foreign = tools.find((x) => x.workspaceId === otherWs)!;
		sys.connectors.resolveTool.mockResolvedValueOnce(foreign);
		const response = await sys.bridge(
			{ executionId: exec.id, actor: actor(), clientId: null },
			1,
			'gh.listIssues',
			{}
		);
		expect(response).toMatchObject({ kind: 'error', code: 'workspace_mismatch' });
		expect(sys.connectors.upstream).toHaveLength(0);
	});

	it('rejects a context whose workspace differs from the execution', async () => {
		const sys = makeSystem(t.db, {});
		const exec = await runningExecution(t.db);
		const response = await sys.bridge(
			{ executionId: exec.id, actor: { ...actor(), workspaceId: otherWs }, clientId: null },
			1,
			'gh.listIssues',
			{}
		);
		expect(response).toMatchObject({ kind: 'error', code: 'workspace_mismatch' });
		expect(sys.connectors.upstream).toHaveLength(0);
	});

	it('unknown paths are errors, not calls', async () => {
		const sys = makeSystem(t.db, {});
		const exec = await runningExecution(t.db);
		const response = await sys.bridge(
			{ executionId: exec.id, actor: actor(), clientId: null },
			1,
			'slack.post',
			{}
		);
		expect(response).toMatchObject({ kind: 'error', code: 'unknown_tool' });
	});

	it('refuses calls when the execution is not running', async () => {
		const sys = makeSystem(t.db, {});
		const exec = await runningExecution(t.db);
		await t.db.update(execution).set({ status: 'paused' }).where(eq(execution.id, exec.id));
		const response = await sys.bridge(
			{ executionId: exec.id, actor: actor(), clientId: null },
			1,
			'gh.listIssues',
			{}
		);
		expect(response).toMatchObject({ kind: 'error', code: 'execution_not_running' });
	});

	it('replays cached results and refuses a different call at the same seq', async () => {
		const sys = makeSystem(t.db, {});
		const exec = await runningExecution(t.db);
		const ctx = { executionId: exec.id, actor: actor(), clientId: null };
		const first = await sys.bridge(ctx, 1, 'gh.listIssues', { q: 1 });
		const replay = await sys.bridge(ctx, 1, 'gh.listIssues', { q: 1 });
		expect(replay).toEqual(first);
		expect(sys.connectors.upstream).toHaveLength(1);
		expect(await sys.bridge(ctx, 1, 'gh.listIssues', { q: 2 })).toMatchObject({
			code: 'replay_mismatch'
		});
		expect(await sys.bridge(ctx, 1, 'gh.createIssue', { q: 1 })).toMatchObject({
			code: 'replay_mismatch'
		});
	});

	it('an interrupted write (claimed, no outcome) is never retried', async () => {
		const sys = makeSystem(t.db, {});
		const exec = await runningExecution(t.db);
		const createIssue = tools.find((x) => x.path === 'gh.createIssue')!;
		await t.db.insert(executionCall).values({
			executionId: exec.id,
			seq: 1,
			toolId: createIssue.toolId,
			path: 'gh.createIssue',
			status: 'pending',
			isWrite: true
		});
		const response = await sys.bridge(
			{ executionId: exec.id, actor: actor(), clientId: null },
			1,
			'gh.createIssue',
			{}
		);
		expect(response).toMatchObject({ kind: 'error', code: 'outcome_unknown' });
		expect(sys.connectors.upstream).toHaveLength(0);
	});
});

describe('pending approvals listing', () => {
	it("lists the user's paused executions, scoped by workspace and client, never others'", async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		tools.push(
			await seedResolved(t.db, otherWs, tools[3].connectorId, 'gh.createIssue', {
				readOnlyHint: false
			})
		);
		const mine = await sys.service.start({
			actor: actor(),
			clientId: 'claude',
			code: 'deleteRepo'
		});
		const otherClient = await sys.service.start({
			actor: actor(),
			clientId: 'cursor',
			code: 'deleteRepo'
		});
		const otherWorkspace = await sys.service.start({
			actor: { workspaceId: otherWs, userId: user, role: 'owner' },
			clientId: 'claude',
			code: 'readThenWrite'
		});
		const peers = await sys.service.start({
			actor: { workspaceId: ws, userId: peer, role: 'member' },
			clientId: 'claude',
			code: 'deleteRepo'
		});
		for (const outcome of [mine, otherClient, otherWorkspace, peers]) {
			expect(outcome.status).toBe('awaiting_approval');
		}

		const scoped = await sys.service.listPendingApprovals(user, {
			workspaceId: ws,
			clientId: 'claude'
		});
		expect(scoped).toHaveLength(1);
		expect(scoped[0]).toMatchObject({
			executionId: mine.executionId,
			workspaceId: ws,
			workspaceName: 'Acme',
			connectorName: 'GitHub',
			toolPath: 'gh.deleteRepo',
			status: 'pending',
			approvalUrl: `https://toolkien.test/approve/${mine.approval!.approvalId}`
		});
		expect(scoped[0].argumentsPreview).toContain('a/b');

		const ids = async (scope?: { workspaceId?: string; clientId?: string }) =>
			(await sys.service.listPendingApprovals(user, scope)).map((p) => p.executionId).sort();
		expect(await ids({ workspaceId: ws })).toEqual(
			[mine.executionId, otherClient.executionId].sort()
		);
		expect(await ids({ clientId: 'claude' })).toEqual(
			[mine.executionId, otherWorkspace.executionId].sort()
		);
		expect(await ids()).toEqual(
			[mine.executionId, otherClient.executionId, otherWorkspace.executionId].sort()
		);
		// The admin of the workspace does not get members' approvals in their own listing
		expect(await sys.service.listPendingApprovals(admin, { workspaceId: ws })).toEqual([]);
		expect(
			(await sys.service.listPendingApprovals(peer, { workspaceId: ws })).map((p) => p.executionId)
		).toEqual([peers.executionId]);
	});

	it('leaves out expired, decided and cancelled executions', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const expiring = await sys.service.start({
			actor: actor(),
			clientId: 'claude',
			code: 'deleteRepo'
		});
		nowMs += 20 * 60 * 1000;
		const decided = await sys.service.start({
			actor: actor(),
			clientId: 'claude',
			code: 'deleteRepo'
		});
		const cancelled = await sys.service.start({
			actor: actor(),
			clientId: 'claude',
			code: 'deleteRepo'
		});
		const fresh = await sys.service.start({
			actor: actor(),
			clientId: 'claude',
			code: 'deleteRepo'
		});
		await sys.service.decideApproval({
			approvalId: decided.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'reject' }
		});
		await sys.service.cancel({ userId: user, executionId: cancelled.executionId });
		// The first one is past its 30 minutes, even before the expiry job ran
		nowMs += 11 * 60 * 1000;
		const listed = await sys.service.listPendingApprovals(user, {
			workspaceId: ws,
			clientId: 'claude'
		});
		expect(listed.map((p) => p.executionId)).toEqual([fresh.executionId]);
		expect(expiring.status).toBe('awaiting_approval');
	});
});

describe('client of an execution', () => {
	it('labels every audit event of the execution and its pending approvals with the client', async () => {
		const sys = makeSystem(t.db, PROGRAMS);
		const paused = await sys.service.start({
			actor: actor(),
			clientId: 'dcr-1',
			clientName: ' Claude Code ',
			clientInfo: 'claude-code 2.1.3',
			code: 'readThenWrite'
		});
		const [pending] = await sys.service.listPendingApprovals(user);
		expect(pending).toMatchObject({ clientName: 'Claude Code', clientInfo: 'claude-code 2.1.3' });
		expect(
			await sys.service.getApproval({ approvalId: paused.approval!.approvalId, viewerUserId: user })
		).toMatchObject({ clientName: 'Claude Code', clientInfo: 'claude-code 2.1.3' });

		await sys.service.decideApproval({
			approvalId: paused.approval!.approvalId,
			deciderUserId: user,
			decision: { decision: 'approve', scope: 'once' }
		});
		await sys.service.status({ userId: user, executionId: paused.executionId, resume: true });
		const events = sys.audit.record.mock.calls.map(
			(c) => (c as unknown as [{ type: string; clientName?: string; clientInfo?: string }])[0]
		);
		expect(events.map((e) => e.type)).toEqual(
			expect.arrayContaining([
				'execution.started',
				'tool.called',
				'approval.requested',
				'execution.paused',
				'approval.decided',
				'execution.completed'
			])
		);
		for (const e of events) {
			expect(e).toMatchObject({ clientName: 'Claude Code', clientInfo: 'claude-code 2.1.3' });
		}
	});
});
