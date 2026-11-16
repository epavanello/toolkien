import { eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEventInput } from '#lib/server/audit/types.ts';
import type { Db } from '#lib/server/db/index.ts';
import {
	permissionLevel,
	tool,
	toolVersion,
	workspacePolicy
} from '#lib/server/db/schema/index.ts';
import {
	bumpToolSignature,
	createTestDb,
	seedConnector,
	seedMember,
	seedTool,
	seedUser,
	seedWorkspace,
	type TestDb
} from '#lib/server/executions/testing.ts';
import { createPermissionsService } from './service.ts';

let t: TestDb;
let db: Db;
const makeAudit = () => ({ record: vi.fn(async (_event: AuditEventInput) => {}) });
let audit: ReturnType<typeof makeAudit>;
let service: ReturnType<typeof createPermissionsService>;
let ws: string;
let other: string;
let admin: string;
let memberId: string;
let outsider: string;
let readTool: string;
let writeTool: string;
let urlTool: string;
let communityTool: string;
let foreignTool: string;
let privateTool: string;

beforeEach(async () => {
	t = await createTestDb();
	db = t.db;
	audit = makeAudit();
	service = createPermissionsService({ db, audit });
	ws = await seedWorkspace(db);
	other = await seedWorkspace(db);
	admin = await seedUser(db);
	memberId = await seedUser(db);
	outsider = await seedUser(db);
	await seedMember(db, ws, admin, 'admin');
	await seedMember(db, ws, memberId, 'member');
	await seedMember(db, other, outsider, 'owner');
	const curated = await seedConnector(db, ws, { namespace: 'gh' });
	const free = await seedConnector(db, ws, { namespace: 'free', source: 'url' });
	const community = await seedConnector(db, ws, { namespace: 'community', unverified: true });
	const mine = await seedConnector(db, ws, { namespace: 'mine', ownerUserId: admin });
	const foreign = await seedConnector(db, other, { namespace: 'gh' });
	readTool = await seedTool(db, ws, curated.id, {
		path: 'gh.listIssues',
		annotations: { readOnlyHint: true }
	});
	writeTool = await seedTool(db, ws, curated.id, { path: 'gh.createIssue' });
	urlTool = await seedTool(db, ws, free.id, {
		path: 'free.read',
		annotations: { readOnlyHint: true }
	});
	communityTool = await seedTool(db, ws, community.id, {
		path: 'community.read',
		annotations: { readOnlyHint: true }
	});
	privateTool = await seedTool(db, ws, mine.id, {
		path: 'mine.send',
		annotations: { readOnlyHint: true }
	});
	foreignTool = await seedTool(db, other, foreign.id, {
		path: 'gh.listIssues',
		annotations: { readOnlyHint: true }
	});
});

afterEach(() => t.cleanup());

const level = async (userId: string, toolId: string) =>
	service.getEffectiveLevel({ workspaceId: ws, userId, toolId });

const httpCode = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (e) {
		return (e as { body?: { code?: string } }).body?.code;
	}
	return 'resolved';
};

/** The error body of a rejected call (code and user-facing message) */
const httpError = (promise: Promise<unknown>) =>
	promise.then(
		() => ({ code: 'resolved', message: '' }),
		(e: { body?: { code?: string; message?: string } }) => ({
			code: e.body?.code,
			message: e.body?.message ?? ''
		})
	);

const rowCount = async () => (await db.select().from(permissionLevel)).length;

describe('permissions service', () => {
	it('applies the default table', async () => {
		expect((await level(memberId, readTool)).level).toBe('allow');
		expect((await level(memberId, writeTool)).level).toBe('ask');
		expect(await level(memberId, urlTool)).toMatchObject({ level: 'ask', needsConfirmation: true });
		// Community / needs-review directory entries: proposed like a free URL
		expect(await level(memberId, communityTool)).toMatchObject({
			level: 'ask',
			needsConfirmation: true
		});
	});

	it('denies tools of another workspace, unknown ids and private connectors of others', async () => {
		expect((await level(memberId, foreignTool)).level).toBe('block');
		expect((await level(memberId, 'nope')).level).toBe('block');
		expect((await level(memberId, privateTool)).level).toBe('block');
		expect((await level(admin, privateTool)).level).toBe('allow');
	});

	it('discovery hides blocked tools', async () => {
		await service.setLevel({
			workspaceId: ws,
			actorUserId: memberId,
			userId: memberId,
			toolId: writeTool,
			level: 'block'
		});
		const visible = await service.visibleToolIds(ws, memberId, [
			readTool,
			writeTool,
			foreignTool,
			urlTool
		]);
		expect(visible).toEqual([readTool, urlTool]);
	});

	it('first configuration confirms a free-URL tool', async () => {
		await service.setLevel({
			workspaceId: ws,
			actorUserId: memberId,
			userId: memberId,
			toolId: urlTool,
			level: 'allow'
		});
		expect(await level(memberId, urlTool)).toEqual({
			level: 'allow',
			needsConfirmation: false,
			source: 'user'
		});
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'permission.changed', toolPath: 'free.read' })
		);
	});

	it('a signature change sends the tool back to "to confirm"', async () => {
		await service.setLevel({
			workspaceId: ws,
			actorUserId: memberId,
			userId: memberId,
			toolId: writeTool,
			level: 'allow'
		});
		expect((await level(memberId, writeTool)).level).toBe('allow');
		await bumpToolSignature(db, writeTool, 'sig-2');
		expect(await level(memberId, writeTool)).toMatchObject({
			level: 'ask',
			needsConfirmation: true
		});
		await service.setLevel({
			workspaceId: ws,
			actorUserId: memberId,
			userId: memberId,
			toolId: writeTool,
			level: 'allow'
		});
		expect(await level(memberId, writeTool)).toMatchObject({
			level: 'allow',
			needsConfirmation: false
		});
	});

	it('members cannot set workspace rows or rows of other users', async () => {
		expect(
			await httpCode(
				service.setLevel({
					workspaceId: ws,
					actorUserId: memberId,
					userId: null,
					toolId: writeTool,
					level: 'allow'
				})
			)
		).toBe('FORBIDDEN');
		expect(
			await httpCode(
				service.setLevel({
					workspaceId: ws,
					actorUserId: admin,
					userId: memberId,
					toolId: writeTool,
					level: 'allow'
				})
			)
		).toBe('FORBIDDEN');
	});

	it('non-members and foreign tools are rejected', async () => {
		expect(
			await httpCode(
				service.setLevel({
					workspaceId: ws,
					actorUserId: outsider,
					userId: outsider,
					toolId: readTool,
					level: 'allow'
				})
			)
		).toBe('NOT_FOUND');
		expect(
			await httpCode(
				service.setLevel({
					workspaceId: ws,
					actorUserId: memberId,
					userId: memberId,
					toolId: foreignTool,
					level: 'allow'
				})
			)
		).toBe('NOT_FOUND');
	});

	it('admin floor: members can only tighten', async () => {
		await service.setLevel({
			workspaceId: ws,
			actorUserId: admin,
			userId: null,
			toolId: readTool,
			level: 'ask'
		});
		expect((await level(memberId, readTool)).level).toBe('ask');
		expect(
			await httpCode(
				service.setLevel({
					workspaceId: ws,
					actorUserId: memberId,
					userId: memberId,
					toolId: readTool,
					level: 'allow'
				})
			)
		).toBe('POLICY_DENIED');
		await service.setLevel({
			workspaceId: ws,
			actorUserId: memberId,
			userId: memberId,
			toolId: readTool,
			level: 'block'
		});
		expect((await level(memberId, readTool)).level).toBe('block');
		// The admin's own level is unaffected by the member's choice
		expect((await level(admin, readTool)).level).toBe('ask');
	});

	it('workspace policy floor applies to every tool and to setLevel', async () => {
		await db.insert(workspacePolicy).values({ workspaceId: ws, permissionFloor: 'ask' });
		expect(await level(memberId, readTool)).toMatchObject({ level: 'ask', source: 'policy' });
		expect(
			await httpCode(
				service.setLevel({
					workspaceId: ws,
					actorUserId: admin,
					userId: null,
					toolId: readTool,
					level: 'allow'
				})
			)
		).toBe('POLICY_DENIED');
		await db
			.update(workspacePolicy)
			.set({ permissionFloor: 'block' })
			.where(eq(workspacePolicy.workspaceId, ws));
		expect((await level(admin, readTool)).level).toBe('block');
	});

	it('updates rows in place (one row per scope)', async () => {
		for (const l of ['block', 'allow', 'ask'] as const) {
			await service.setLevel({
				workspaceId: ws,
				actorUserId: memberId,
				userId: memberId,
				toolId: writeTool,
				level: l
			});
		}
		await service.setLevel({
			workspaceId: ws,
			actorUserId: admin,
			userId: null,
			toolId: writeTool,
			level: 'ask'
		});
		await service.setLevel({
			workspaceId: ws,
			actorUserId: admin,
			userId: null,
			toolId: writeTool,
			level: 'ask'
		});
		const list = await service.listToolPermissions({
			workspaceId: ws,
			userId: memberId,
			role: 'member'
		});
		const row = list.find((r) => r.toolId === writeTool)!;
		expect(row).toMatchObject({ userLevel: 'ask', workspaceLevel: 'ask', floor: 'ask' });
	});

	it('lists only visible tools with their flags', async () => {
		const list = await service.listToolPermissions({
			workspaceId: ws,
			userId: memberId,
			role: 'member'
		});
		expect(list.map((r) => r.path)).toEqual([
			'community.read',
			'free.read',
			'gh.createIssue',
			'gh.listIssues'
		]);
		const free = list.find((r) => r.path === 'free.read')!;
		expect(free).toMatchObject({
			unverified: true,
			defaultLevel: 'allow',
			effective: { level: 'ask', needsConfirmation: true }
		});
		expect(list.find((r) => r.path === 'gh.createIssue')!.unannotated).toBe(true);
		// The UI groups rows by operation type from the current version's annotations
		expect(list.find((r) => r.path === 'gh.listIssues')!.annotations).toEqual({
			readOnlyHint: true
		});
	});
});

describe('setLevels (bulk)', () => {
	const bulk = (input: {
		actorUserId: string;
		userId: string | null;
		toolIds: string[];
		level: 'allow' | 'ask' | 'block' | 'current';
	}) => service.setLevels({ workspaceId: ws, ...input });

	it('sets every tool of one scope, confirms them and audits one event per tool', async () => {
		await bumpToolSignature(db, writeTool, 'sig-2');
		const result = await bulk({
			actorUserId: memberId,
			userId: memberId,
			toolIds: [readTool, writeTool, urlTool, urlTool],
			level: 'block'
		});
		// Duplicates count once
		expect(result).toEqual({ updated: 3 });
		for (const id of [readTool, writeTool, urlTool]) {
			expect(await level(memberId, id)).toEqual({
				level: 'block',
				needsConfirmation: false,
				source: 'user'
			});
		}
		// Other users and the workspace rows are untouched
		expect((await level(admin, readTool)).level).toBe('allow');
		expect(audit.record).toHaveBeenCalledTimes(3);
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({
				type: 'permission.changed',
				toolPath: 'gh.createIssue',
				metadata: { toolId: writeTool, scope: 'user', level: 'block', previous: null, bulk: 3 }
			})
		);

		// Again: rows are updated in place, `previous` is the old level
		await bulk({ actorUserId: memberId, userId: memberId, toolIds: [readTool], level: 'ask' });
		expect(audit.record).toHaveBeenLastCalledWith(
			expect.objectContaining({
				metadata: { toolId: readTool, scope: 'user', level: 'ask', previous: 'block' }
			})
		);
		expect(await rowCount()).toBe(3);
	});

	it('"current" confirms the level each tool has now', async () => {
		await service.setLevel({
			workspaceId: ws,
			actorUserId: memberId,
			userId: memberId,
			toolId: writeTool,
			level: 'block'
		});
		await bumpToolSignature(db, writeTool, 'sig-2');
		expect(await level(memberId, writeTool)).toMatchObject({ needsConfirmation: true });
		await bulk({
			actorUserId: memberId,
			userId: memberId,
			toolIds: [urlTool, communityTool, writeTool],
			level: 'current'
		});
		// The proposed default of unverified connectors, and the user's own row
		expect(await level(memberId, urlTool)).toEqual({
			level: 'allow',
			needsConfirmation: false,
			source: 'user'
		});
		expect((await level(memberId, communityTool)).level).toBe('allow');
		expect(await level(memberId, writeTool)).toMatchObject({
			level: 'block',
			needsConfirmation: false
		});
		// Admins confirming the workspace rows: the workspace row, else the default
		await bulk({ actorUserId: admin, userId: null, toolIds: [urlTool], level: 'current' });
		expect(
			(await service.listToolPermissions({ workspaceId: ws, userId: admin, role: 'admin' })).find(
				(r) => r.toolId === urlTool
			)
		).toMatchObject({ workspaceLevel: 'allow', effective: { needsConfirmation: false } });
	});

	it('is all or nothing: a floor on one tool refuses the batch and names it', async () => {
		await service.setLevel({
			workspaceId: ws,
			actorUserId: admin,
			userId: null,
			toolId: readTool,
			level: 'ask'
		});
		audit.record.mockClear();
		const before = await rowCount();
		const refused = await httpError(
			bulk({
				actorUserId: memberId,
				userId: memberId,
				toolIds: [urlTool, readTool, communityTool],
				level: 'allow'
			})
		);
		expect(refused.code).toBe('POLICY_DENIED');
		expect(refused.message).toContain('Nothing was changed');
		expect(refused.message).toContain('gh.listIssues');
		expect(refused.message).not.toContain('free.read');
		expect(await rowCount()).toBe(before);
		expect(await level(memberId, urlTool)).toMatchObject({ needsConfirmation: true });
		expect(audit.record).not.toHaveBeenCalled();

		// Without the floored tool the same change goes through
		await bulk({
			actorUserId: memberId,
			userId: memberId,
			toolIds: [urlTool, communityTool],
			level: 'allow'
		});
		expect((await level(memberId, urlTool)).level).toBe('allow');
	});

	it('"current" below a newer workspace minimum is refused, not silently tightened', async () => {
		await service.setLevel({
			workspaceId: ws,
			actorUserId: memberId,
			userId: memberId,
			toolId: writeTool,
			level: 'allow'
		});
		await service.setLevel({
			workspaceId: ws,
			actorUserId: admin,
			userId: null,
			toolId: writeTool,
			level: 'ask'
		});
		await bumpToolSignature(db, writeTool, 'sig-2');
		expect(
			await httpCode(
				bulk({
					actorUserId: memberId,
					userId: memberId,
					toolIds: [writeTool, urlTool],
					level: 'current'
				})
			)
		).toBe('POLICY_DENIED');
		expect(await level(memberId, urlTool)).toMatchObject({ needsConfirmation: true });
	});

	it('the workspace scope follows the policy floor and is for admins only', async () => {
		expect(
			await httpCode(
				bulk({ actorUserId: memberId, userId: null, toolIds: [readTool], level: 'block' })
			)
		).toBe('FORBIDDEN');
		expect(
			await httpCode(
				bulk({ actorUserId: admin, userId: memberId, toolIds: [readTool], level: 'block' })
			)
		).toBe('FORBIDDEN');
		expect(
			await httpCode(
				bulk({ actorUserId: outsider, userId: outsider, toolIds: [readTool], level: 'block' })
			)
		).toBe('NOT_FOUND');

		await db.insert(workspacePolicy).values({ workspaceId: ws, permissionFloor: 'ask' });
		const refused = await httpError(
			bulk({ actorUserId: admin, userId: null, toolIds: [readTool, writeTool], level: 'allow' })
		);
		expect(refused.code).toBe('POLICY_DENIED');
		expect(refused.message).toContain('gh.createIssue, gh.listIssues');
		await bulk({ actorUserId: admin, userId: null, toolIds: [readTool, writeTool], level: 'ask' });
		const list = await service.listToolPermissions({
			workspaceId: ws,
			userId: memberId,
			role: 'member'
		});
		expect(list.find((r) => r.toolId === readTool)).toMatchObject({
			workspaceLevel: 'ask',
			floor: 'ask',
			policyFloor: 'ask'
		});
		expect(audit.record).toHaveBeenCalledWith(
			expect.objectContaining({ metadata: expect.objectContaining({ scope: 'workspace' }) })
		);
	});

	it('refuses the batch when a tool is not visible (foreign, private, unknown)', async () => {
		for (const hidden of [foreignTool, privateTool, 'nope']) {
			const refused = await httpError(
				bulk({
					actorUserId: memberId,
					userId: memberId,
					toolIds: [readTool, hidden],
					level: 'block'
				})
			);
			expect(refused).toMatchObject({ code: 'NOT_FOUND' });
			expect(refused.message).toContain('Nothing was changed');
		}
		expect(await rowCount()).toBe(0);
		expect(
			await bulk({ actorUserId: memberId, userId: memberId, toolIds: [], level: 'block' })
		).toEqual({ updated: 0 });
	});

	it('rolls back every row when a write fails midway (several statements)', async () => {
		const connectorId = (await seedConnector(db, ws, { namespace: 'many' })).id;
		const ids = Array.from({ length: 450 }, () => randomUUID());
		await db.insert(tool).values(
			ids.map((id, i) => ({
				id,
				workspaceId: ws,
				connectorId,
				upstreamName: `t${i}`,
				path: `many.t${i}`,
				currentVersion: 1
			}))
		);
		await db
			.insert(toolVersion)
			.values(
				ids.map((toolId) => ({ toolId, version: 1, inputSchema: {}, signatureHash: 'sig-1' }))
			);
		const last = ids.at(-1)!;
		await db.run(
			sql.raw(
				`create trigger fail_last before insert on permission_level when new.tool_id = '${last}' begin select raise(abort, 'boom'); end`
			)
		);
		await expect(
			bulk({ actorUserId: memberId, userId: memberId, toolIds: ids, level: 'block' })
		).rejects.toThrow();
		expect(await rowCount()).toBe(0);
		expect(audit.record).not.toHaveBeenCalled();

		await db.run(sql.raw('drop trigger fail_last'));
		expect(
			await bulk({ actorUserId: memberId, userId: memberId, toolIds: ids, level: 'block' })
		).toEqual({ updated: 450 });
		expect(await rowCount()).toBe(450);
	});
});
