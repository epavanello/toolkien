import { describe, expect, it } from 'vitest';
import { defaultLevel, floorFor, resolveEffectiveLevel, satisfiesFloor } from './resolve.ts';
import { mostRestrictive, type ResolveLevelInput } from './types.ts';

const base: ResolveLevelInput = {
	source: 'directory',
	annotations: { readOnlyHint: true },
	signatureHash: 'sig',
	policyFloor: null,
	workspaceRow: null,
	userRow: null
};
const row = (level: 'allow' | 'ask' | 'block', hash: string | null = 'sig') => ({
	level,
	confirmedSignatureHash: hash
});

describe('defaultLevel (spec table)', () => {
	it('curated read-only → allow', () => {
		expect(defaultLevel({ source: 'directory', annotations: { readOnlyHint: true } })).toBe(
			'allow'
		);
	});
	it('curated write → ask', () => {
		expect(defaultLevel({ source: 'directory', annotations: { readOnlyHint: false } })).toBe('ask');
	});
	it('curated destructive → ask, even if also marked read-only', () => {
		expect(defaultLevel({ source: 'directory', annotations: { destructiveHint: true } })).toBe(
			'ask'
		);
		expect(
			defaultLevel({
				source: 'directory',
				annotations: { readOnlyHint: true, destructiveHint: true }
			})
		).toBe('ask');
	});
	it('no annotations → treated as a write → ask', () => {
		expect(defaultLevel({ source: 'directory', annotations: null })).toBe('ask');
		expect(defaultLevel({ source: 'directory', annotations: {} })).toBe('ask');
		expect(defaultLevel({ source: 'url', annotations: null })).toBe('ask');
	});
	it('free URL proposes the same rule', () => {
		expect(defaultLevel({ source: 'url', annotations: { readOnlyHint: true } })).toBe('allow');
	});
	it('only a literal true counts as read-only', () => {
		const sneaky = { readOnlyHint: 'true' } as unknown as { readOnlyHint: boolean };
		expect(defaultLevel({ source: 'directory', annotations: sneaky })).toBe('ask');
	});
});

describe('mostRestrictive', () => {
	it('orders block > ask > allow and ignores empties', () => {
		expect(mostRestrictive()).toBe('allow');
		expect(mostRestrictive('allow', null, undefined)).toBe('allow');
		expect(mostRestrictive('allow', 'ask')).toBe('ask');
		expect(mostRestrictive('block', 'ask', 'allow')).toBe('block');
	});
});

describe('resolveEffectiveLevel', () => {
	it('curated read-only with no rows → allow from default', () => {
		expect(resolveEffectiveLevel(base)).toEqual({
			level: 'allow',
			needsConfirmation: false,
			source: 'default'
		});
	});

	it('free URL without rows is "to confirm" and at least ask', () => {
		expect(resolveEffectiveLevel({ ...base, source: 'url' })).toEqual({
			level: 'ask',
			needsConfirmation: true,
			source: 'default'
		});
	});

	it('free URL confirmed by the user follows the confirmed level', () => {
		const result = resolveEffectiveLevel({ ...base, source: 'url', userRow: row('allow') });
		expect(result).toEqual({ level: 'allow', needsConfirmation: false, source: 'user' });
	});

	it('a user may loosen their own default when no floor exists', () => {
		const result = resolveEffectiveLevel({
			...base,
			annotations: null,
			userRow: row('allow')
		});
		expect(result.level).toBe('allow');
	});

	it('a user may tighten', () => {
		expect(resolveEffectiveLevel({ ...base, userRow: row('block') }).level).toBe('block');
	});

	it('policy floor wins over a looser user level', () => {
		const result = resolveEffectiveLevel({ ...base, policyFloor: 'ask', userRow: row('allow') });
		expect(result).toEqual({ level: 'ask', needsConfirmation: false, source: 'policy' });
	});

	it('admin workspace row is a floor members cannot loosen', () => {
		const result = resolveEffectiveLevel({
			...base,
			workspaceRow: row('block'),
			userRow: row('allow')
		});
		expect(result).toEqual({ level: 'block', needsConfirmation: false, source: 'workspace' });
	});

	it('admin workspace row is the default when the user has none', () => {
		const result = resolveEffectiveLevel({
			...base,
			annotations: null,
			workspaceRow: row('allow')
		});
		expect(result).toEqual({ level: 'allow', needsConfirmation: false, source: 'workspace' });
	});

	it('signature change sends a confirmed allow back to ask, "to confirm"', () => {
		const result = resolveEffectiveLevel({ ...base, userRow: row('allow', 'old-sig') });
		expect(result).toEqual({ level: 'ask', needsConfirmation: true, source: 'user' });
	});

	it('a stale block stays blocked (never loosened by a signature change)', () => {
		const result = resolveEffectiveLevel({ ...base, userRow: row('block', 'old-sig') });
		expect(result.level).toBe('block');
		expect(result.needsConfirmation).toBe(true);
	});

	it('a row never confirmed against any signature is "to confirm"', () => {
		const result = resolveEffectiveLevel({ ...base, userRow: row('allow', null) });
		expect(result).toMatchObject({ level: 'ask', needsConfirmation: true });
	});

	it('stale workspace default for members is "to confirm"', () => {
		const result = resolveEffectiveLevel({ ...base, workspaceRow: row('allow', 'old') });
		expect(result).toMatchObject({ level: 'ask', needsConfirmation: true });
	});

	it('policy block beats everything', () => {
		const result = resolveEffectiveLevel({
			...base,
			policyFloor: 'block',
			workspaceRow: row('allow'),
			userRow: row('allow')
		});
		expect(result).toEqual({ level: 'block', needsConfirmation: false, source: 'policy' });
	});

	it('every combination is at least as restrictive as each floor', () => {
		const levels = ['allow', 'ask', 'block'] as const;
		for (const policyFloor of [null, ...levels]) {
			for (const ws of [null, ...levels]) {
				for (const user of [null, ...levels]) {
					for (const source of ['directory', 'url'] as const) {
						const result = resolveEffectiveLevel({
							...base,
							source,
							policyFloor,
							workspaceRow: ws ? row(ws) : null,
							userRow: user ? row(user) : null
						});
						expect(satisfiesFloor(result.level, floorFor(policyFloor, ws ? row(ws) : null))).toBe(
							true
						);
						if (result.needsConfirmation) expect(result.level).not.toBe('allow');
					}
				}
			}
		}
	});
});
