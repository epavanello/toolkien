import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditEventInput } from '#lib/server/audit/types.ts';
import type { Db } from '#lib/server/db/index.ts';
import { workspacePolicy } from '#lib/server/db/schema/index.ts';
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
