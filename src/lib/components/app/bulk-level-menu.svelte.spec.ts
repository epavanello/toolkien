import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { ToolPermission } from '#lib/server/permissions/types.ts';
import BulkLevelMenu from './bulk-level-menu.svelte';

const { setToolLevels } = vi.hoisted(() => ({
	setToolLevels: vi.fn(async (input: { toolIds: string[] }) => ({ updated: input.toolIds.length }))
}));
vi.mock('#lib/functions/permissions.remote.ts', () => ({ setToolLevels }));

const tool = (toolId: string, overrides: Partial<ToolPermission> = {}): ToolPermission => ({
	toolId,
	path: `dev.${toolId}`,
	connectorId: 'c1',
	connectorName: 'Dev MCP',
	source: 'url',
	unverified: true,
	readOnly: false,
	destructive: true,
	unannotated: false,
	annotations: { destructiveHint: true },
	effective: { level: 'ask', needsConfirmation: true, source: 'default' },
	defaultLevel: 'ask',
	chosen: 'ask',
	userLevel: null,
	workspaceLevel: null,
	floor: 'allow',
	policyFloor: null,
	...overrides
});

describe('BulkLevelMenu', () => {
	it('confirms with the count, is explicit about destructive tools, then saves once', async () => {
		render(BulkLevelMenu, {
			workspace: 'acme',
			subject: 'in “Destructive” of Dev MCP',
			tools: [tool('deleteNote'), tool('dropAll'), tool('purge', { floor: 'ask' })]
		});
		await userEvent.click(page.getByRole('button', { name: /^Set all/ }));
		// No workspace minimum for members
		expect(page.getByText('Workspace minimum').elements()).toHaveLength(0);
		await userEvent.click(page.getByRole('menuitem', { name: 'Always allow (2 of 3)' }));

		const dialog = page.getByRole('alertdialog');
		await expect.element(dialog).toHaveTextContent('“Always allow” for 2 tools?');
		await expect
			.element(dialog)
			.toHaveTextContent('All 2 are destructive (dev.deleteNote, dev.dropAll)');
		await expect.element(dialog).toHaveTextContent('1 tool keeps its level');
		expect(setToolLevels).not.toHaveBeenCalled();

		await userEvent.click(dialog.getByRole('button', { name: 'Always allow 2 tools' }));
		expect(setToolLevels).toHaveBeenCalledTimes(1);
		expect(setToolLevels).toHaveBeenCalledWith({
			workspace: 'acme',
			toolIds: ['deleteNote', 'dropAll'],
			level: 'allow',
			scope: 'user'
		});
	});

	it('offers the workspace minimum to admins and "Confirm" for the tools to confirm', async () => {
		setToolLevels.mockClear();
		render(BulkLevelMenu, {
			workspace: 'acme',
			subject: 'of Dev MCP',
			canSetWorkspaceLevels: true,
			tools: [
				tool('a'),
				tool('b', { effective: { level: 'ask', needsConfirmation: false, source: 'user' } })
			]
		});
		await userEvent.click(page.getByRole('button', { name: /^Set all/ }));
		await expect.element(page.getByText('Workspace minimum · 2 tools')).toBeInTheDocument();
		await userEvent.click(page.getByRole('menuitem', { name: 'Confirm 1 to confirm' }));
		await userEvent.click(
			page.getByRole('alertdialog').getByRole('button', { name: 'Confirm 1 tool' })
		);
		expect(setToolLevels).toHaveBeenCalledWith({
			workspace: 'acme',
			toolIds: ['a'],
			level: 'current',
			scope: 'user'
		});
	});
});
