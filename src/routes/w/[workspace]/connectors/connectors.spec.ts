import { describe, expect, it } from 'vitest';
import { heaviestConnector, lastCheck, syncSummary } from './connectors.ts';

describe('sync wording', () => {
	it('says what changed and which tools to look at, for the toast and the notice alike', () => {
		expect(
			syncSummary({
				added: 1,
				updated: 4,
				removed: 0,
				signatureChanged: ['devpost.saveGrowthGoal'],
				descriptionChanged: ['devpost.listPosts']
			})
		).toEqual({
			changes: '1 added, 4 updated',
			details:
				'Signature changed: devpost.saveGrowthGoal (permissions to confirm). Description changed: devpost.listPosts. Review before trusting.'
		});
		expect(
			syncSummary({
				added: 0,
				updated: 0,
				removed: 0,
				signatureChanged: [],
				descriptionChanged: []
			})
		).toEqual({ changes: 'No changes', details: null });
	});

	it('puts the last check after the last change', () => {
		const at = new Date('2026-11-16T10:00:00Z');
		expect(lastCheck({ lastSyncedAt: at })).toEqual({ label: 'checked', value: at });
	});
});

describe('heaviestConnector', () => {
	const connector = (id: string, displayName: string) => ({
		id,
		displayName,
		icon: `/connectors/icon/${id}`
	});
	const github = connector('c1', 'GitHub');
	const linear = connector('c2', 'Linear');

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
