import { describe, expect, it } from 'vitest';
import type { ToolPermission } from '#lib/server/permissions/types.ts';
import { connectorSections, heaviestConnector, type ConnectorInfo } from './permissions.ts';

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

describe('heaviestConnector', () => {
	const github = connector('c1', 'GitHub', 'github');
	const linear = connector('c2', 'Linear', 'linear');

	it('names the first (heaviest) connector with its logo and size', () => {
		const footprint = {
			connectors: [
				{ connectorId: 'c1', tools: 35, chars: 100_000 },
				{ connectorId: 'c2', tools: 5, chars: 8_000 }
			]
		};
		expect(heaviestConnector(footprint, [linear, github])).toEqual({
			name: 'GitHub',
			icon: '/connectors/icon/c1',
			tools: 35,
			chars: 100_000
		});
	});

	it('stays quiet with a single connector or an unknown one', () => {
		expect(
			heaviestConnector({ connectors: [{ connectorId: 'c1', tools: 3, chars: 900 }] }, [github])
		).toBeUndefined();
		expect(
			heaviestConnector(
				{
					connectors: [
						{ connectorId: 'gone', tools: 3, chars: 900 },
						{ connectorId: 'c1', tools: 1, chars: 100 }
					]
				},
				[github]
			)
		).toBeUndefined();
	});
});
