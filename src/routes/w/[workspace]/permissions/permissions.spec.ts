import { describe, expect, it } from 'vitest';
import type { ToolPermission } from '#lib/server/permissions/types.ts';
import { connectorSections, type ConnectorInfo } from './permissions.ts';

const tool = (toolId: string, path: string, connectorId: string) =>
	({
		toolId,
		path,
		connectorId,
		connectorName: `${connectorId} name`,
		unverified: true
	}) as ToolPermission;

const connector = (id: string, displayName: string, namespace: string): ConnectorInfo => ({
	id,
	name: displayName,
	displayName,
	namespace,
	icon: `/connectors/icon/${id}`,
	unverified: false
});

describe('connectorSections', () => {
	it('groups tools by connector, connectors by name, tools in their order', () => {
		const sections = connectorSections(
			[
				tool('a', 'linear.getIssue', 'lin'),
				tool('b', 'github.getIssue', 'gh'),
				tool('c', 'linear.listTeams', 'lin')
			],
			[connector('lin', 'Linear', 'linear'), connector('gh', 'GitHub', 'github')]
		);
		expect(sections.map((s) => [s.displayName, s.tools.map((t) => t.toolId)])).toEqual([
			['GitHub', ['b']],
			['Linear', ['a', 'c']]
		]);
		expect(sections[0]).toMatchObject({ namespace: 'github', icon: '/connectors/icon/gh' });
	});

	it('orders two instances of the same server by namespace', () => {
		const sections = connectorSections(
			[tool('a', 'githubWork.x', 'w'), tool('b', 'githubHome.x', 'h')],
			[connector('w', 'GitHub', 'githubWork'), connector('h', 'GitHub', 'githubHome')]
		);
		expect(sections.map((s) => s.namespace)).toEqual(['githubHome', 'githubWork']);
	});

	it('keeps tools whose connector is not listed, from their own row', () => {
		const [section] = connectorSections([tool('a', 'gone.read', 'x')], []);
		expect(section).toMatchObject({
			id: 'x',
			displayName: 'x name',
			namespace: 'gone',
			icon: null,
			unverified: true
		});
	});
});
