import { describe, expect, it } from 'vitest';
import { contextSavings, estimateTokens, formatTokens } from './tokens.ts';

describe('token estimates', () => {
	it('estimates at 4 characters per token and formats compactly', () => {
		expect(estimateTokens(4000)).toBe(1000);
		expect(formatTokens(41_234)).toBe('≈ 41.2K tokens');
		expect(formatTokens(640)).toBe('≈ 640 tokens');
	});

	it('reports what is saved once the native definitions outweigh the gateway', () => {
		expect(contextSavings({ tools: 40, nativeChars: 100_000, gatewayChars: 10_000 })).toEqual({
			native: 25_000,
			gateway: 2_500,
			saved: 22_500,
			percent: 90,
			toBreakEven: 0
		});
	});

	it('says how many more tools reach break-even, never claiming a saving below it', () => {
		// 4 tools of 1,000 characters each against a 10,000-character gateway: 6 more to tie
		expect(contextSavings({ tools: 4, nativeChars: 4_000, gatewayChars: 10_000 })).toMatchObject({
			saved: 0,
			percent: 0,
			toBreakEven: 6
		});
		expect(contextSavings({ tools: 0, nativeChars: 0, gatewayChars: 10_000 })).toMatchObject({
			saved: 0,
			toBreakEven: 0
		});
	});
});
