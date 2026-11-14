import { describe, expect, it } from 'vitest';
import { formatDateTime, formatDuration, formatNumber } from './format.ts';

describe('format', () => {
	it('formats durations at the right scale', () => {
		expect(formatDuration(840)).toBe('840 ms');
		expect(formatDuration(12_400)).toBe('12.4 s');
		expect(formatDuration(185_000)).toBe('3 min 5 s');
		expect(formatDuration(null)).toBe('—');
	});

	it('formats date-times and missing values', () => {
		expect(formatDateTime(new Date(2026, 10, 14, 10, 32, 5))).toBe('2026-11-14 10:32:05');
		expect(formatDateTime(null)).toBe('—');
		expect(formatDateTime('not a date')).toBe('—');
	});

	it('formats numbers with separators', () => {
		expect(formatNumber(1234567)).toBe('1,234,567');
	});
});
