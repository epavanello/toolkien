import { describe, expect, it } from 'vitest';
import { lastCheck, syncSummary } from './connectors.ts';

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
