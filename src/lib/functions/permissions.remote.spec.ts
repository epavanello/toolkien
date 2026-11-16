import { beforeEach, describe, expect, it, vi } from 'vitest';

// Remote functions run as plain functions: `command` parses its input and calls the handler
const refreshed = vi.fn();
vi.mock('$app/server', () => {
	type Schema = { parse: (v: unknown) => unknown };
	const remote = <F extends object>(type: string, fn: F) => Object.assign(fn, { __: { type } });
	return {
		command: (schema: Schema, fn: (input: unknown) => unknown) =>
			remote('command', async (input: unknown) => fn(schema.parse(input))),
		query: () => remote('query', (slug: string) => ({ refresh: async () => refreshed(slug) }))
	};
});
const guard = vi.fn(async (slug: string, minRole = 'member') => ({
	workspace: { id: 'ws-1', slug, kind: 'company', role: 'admin' },
	actor: { workspaceId: 'ws-1', userId: 'alice', role: minRole }
}));
vi.mock('#lib/server/guards.ts', () => ({ requireWorkspace: guard }));
const setLevels = vi.fn(async (input: { toolIds: string[] }) => ({
	updated: input.toolIds.length
}));
vi.mock('#lib/server/permissions/index.ts', () => ({
	listToolPermissions: async () => [],
	setLevel: async () => undefined,
	setLevels
}));
vi.mock('#lib/server/workspaces/index.ts', () => ({ hasRole: () => true }));

const { setToolLevels } = await import('./permissions.remote.ts');
const call = setToolLevels as unknown as (input: unknown) => Promise<{ updated: number }>;

beforeEach(() => vi.clearAllMocks());

describe('setToolLevels', () => {
	it('sets the viewer’s own levels with the member guard and refreshes listPermissions', async () => {
		expect(
			await call({ workspace: 'acme', toolIds: ['a', 'b'], level: 'block', scope: 'user' })
		).toEqual({ updated: 2 });
		expect(guard).toHaveBeenCalledWith('acme', 'member');
		expect(setLevels).toHaveBeenCalledWith({
			workspaceId: 'ws-1',
			actorUserId: 'alice',
			userId: 'alice',
			toolIds: ['a', 'b'],
			level: 'block'
		});
		expect(refreshed).toHaveBeenCalledWith('acme');
	});

	it('requires an admin for the workspace minimum (userId null)', async () => {
		await call({ workspace: 'acme', toolIds: ['a'], level: 'current', scope: 'workspace' });
		expect(guard).toHaveBeenCalledWith('acme', 'admin');
		expect(setLevels).toHaveBeenCalledWith(
			expect.objectContaining({ userId: null, level: 'current' })
		);
	});

	it('rejects empty lists and unknown levels before any check', async () => {
		for (const input of [
			{ workspace: 'acme', toolIds: [], level: 'allow', scope: 'user' },
			{ workspace: 'acme', toolIds: ['a'], level: 'never', scope: 'user' },
			{ workspace: 'acme', toolIds: ['a'], level: 'allow', scope: 'everyone' }
		]) {
			await expect(call(input)).rejects.toThrow();
		}
		expect(guard).not.toHaveBeenCalled();
		expect(setLevels).not.toHaveBeenCalled();
	});

	it('refreshes nothing when the service refuses the batch', async () => {
		setLevels.mockRejectedValueOnce(new Error('refused'));
		await expect(
			call({ workspace: 'acme', toolIds: ['a'], level: 'allow', scope: 'user' })
		).rejects.toThrow('refused');
		expect(refreshed).not.toHaveBeenCalled();
	});
});
