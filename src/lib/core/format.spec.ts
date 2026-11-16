import { describe, expect, it } from 'vitest';
import {
	clientLabel,
	formatDateTime,
	formatDuration,
	formatFullDate,
	formatNumber,
	formatRelativeShort,
	isRecent,
	machineDate
} from './format.ts';

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

	it('formats relative times short, then as a date', () => {
		const now = new Date(2026, 10, 14, 12, 0, 0);
		const at = (ms: number) => new Date(now.getTime() + ms);
		const min = 60_000;
		expect(formatRelativeShort(at(-10_000), now)).toBe('just now');
		expect(formatRelativeShort(at(-2 * min), now)).toBe('2 min ago');
		expect(formatRelativeShort(at(5 * min), now)).toBe('in 5 min');
		expect(formatRelativeShort(at(-3 * 60 * min), now)).toBe('3 h ago');
		expect(formatRelativeShort(new Date(2026, 10, 13, 9, 0), now)).toBe('yesterday');
		expect(formatRelativeShort(new Date(2026, 10, 15, 9, 0), now)).toBe('tomorrow');
		expect(formatRelativeShort(new Date(2026, 10, 10, 9, 0), now)).toBe('4 days ago');
		expect(formatRelativeShort(new Date(2026, 10, 18, 9, 0), now)).toBe('in 4 days');
		expect(formatRelativeShort(new Date(2026, 10, 3, 9, 0), now)).toBe('3 Nov');
		expect(formatRelativeShort(new Date(2025, 10, 3, 9, 0), now)).toBe('3 Nov 2025');
		expect(formatRelativeShort(null, now)).toBe('—');
		// Calendar dates count in days, in the viewer's time zone
		expect(formatRelativeShort('2026-11-14', now)).toBe('today');
		expect(formatRelativeShort('2026-11-13', now)).toBe('yesterday');
		expect(formatRelativeShort('2026-10-02', now)).toBe('2 Oct');
	});

	it('formats the full date in a locale, and spots recent dates', () => {
		const date = new Date(2026, 10, 14, 10, 32);
		expect(formatFullDate(date, 'en-GB')).toBe('Sat, 14 Nov 2026, 10:32');
		expect(formatFullDate(undefined)).toBe('—');
		expect(formatFullDate('2026-11-14', 'en-GB')).toBe('Sat, 14 Nov 2026');
		expect(machineDate('2026-11-14')).toBe('2026-11-14');
		expect(isRecent(date, new Date(2026, 10, 14, 18, 0))).toBe(true);
		expect(isRecent(date, new Date(2026, 10, 20))).toBe(false);
	});
});

describe('clientLabel', () => {
	it('names the client by its registration and MCP client info', () => {
		expect(clientLabel('Claude Code', 'claude-code 2.1.3')).toBe('Claude Code (claude-code 2.1.3)');
		expect(clientLabel('Cursor', null)).toBe('Cursor');
		expect(clientLabel(null, 'codex-mcp-client 0.40.0')).toBe('codex-mcp-client 0.40.0');
		expect(clientLabel(' Codex ', 'codex')).toBe('Codex');
		expect(clientLabel('  ', undefined)).toBeNull();
	});
});
