import { format } from 'date-fns';

type DateInput = Date | string | number | null | undefined;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A calendar date without time (`2026-11-14`, e.g. a directory check), not an instant */
export const isDateOnly = (value: DateInput): value is string =>
	typeof value === 'string' && DATE_ONLY.test(value);

/** Dates; `YYYY-MM-DD` is read as that day in the viewer's time zone (not UTC midnight) */
const toDate = (value: DateInput) => {
	if (value == null) return null;
	const day = isDateOnly(value) ? DATE_ONLY.exec(value) : null;
	return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(value);
};

/**
 * `2026-11-14 10:32:05` in the viewer's time zone; `—` for missing values. For files and logs:
 * the UI shows dates with `RelativeTime`.
 */
export function formatDateTime(value: DateInput): string {
	const date = toDate(value);
	return date && !Number.isNaN(date.getTime()) ? format(date, 'yyyy-MM-dd HH:mm:ss') : '—';
}

/** `840 ms`, `12.4 s`, `3 min 5 s` */
export function formatDuration(ms: number | null | undefined): string {
	if (ms == null || !Number.isFinite(ms)) return '—';
	if (ms < 1000) return `${Math.round(ms)} ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
	const minutes = Math.floor(ms / 60_000);
	return `${minutes} min ${Math.round((ms % 60_000) / 1000)} s`;
}

/** `1,234` */
export const formatNumber = (value: number | null | undefined) =>
	value == null ? '—' : new Intl.NumberFormat('en-US').format(value);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const startOfDay = (date: Date) =>
	new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/**
 * Short relative time for lists (`just now`, `5 min ago`, `3 h ago`, `yesterday`, `4 days ago`,
 * `3 Nov`, `3 Nov 2025`; future: `in 5 min`, `tomorrow`, `in 4 days`). English labels, like the
 * rest of the UI; `—` for missing values. Pure: pass `now` to test it.
 */
export function formatRelativeShort(value: DateInput, now: Date | number = Date.now()): string {
	const date = toDate(value);
	if (!date || Number.isNaN(date.getTime())) return '—';
	const reference = new Date(now);
	if (isDateOnly(value)) {
		const days = Math.round((startOfDay(reference) - startOfDay(date)) / DAY);
		if (days === 0) return 'today';
		if (Math.abs(days) === 1) return days > 0 ? 'yesterday' : 'tomorrow';
		if (Math.abs(days) < 7) return days > 0 ? `${days} days ago` : `in ${-days} days`;
		return format(date, date.getFullYear() === reference.getFullYear() ? 'd MMM' : 'd MMM yyyy');
	}
	const diff = reference.getTime() - date.getTime();
	const past = diff >= 0;
	const abs = Math.abs(diff);
	const ago = (amount: number, unit: string) =>
		past ? `${amount} ${unit} ago` : `in ${amount} ${unit}`;
	if (abs < 45_000) return 'just now';
	if (abs < HOUR) return ago(Math.max(1, Math.round(abs / MINUTE)), 'min');
	const days = Math.round((startOfDay(reference) - startOfDay(date)) / DAY);
	if (abs < 12 * HOUR || days === 0) return ago(Math.round(abs / HOUR), 'h');
	if (days === 1) return 'yesterday';
	if (days === -1) return 'tomorrow';
	if (Math.abs(days) < 7) return ago(Math.abs(days), 'days');
	return format(date, date.getFullYear() === reference.getFullYear() ? 'd MMM' : 'd MMM yyyy');
}

/**
 * Full date and time in the viewer's locale and time zone (`Sat, 14 Nov 2026, 10:32`), for the
 * tooltip of a relative time. `locale` defaults to the runtime's (the browser's).
 */
export function formatFullDate(value: DateInput, locale?: string): string {
	const date = toDate(value);
	if (!date || Number.isNaN(date.getTime())) return '—';
	return new Intl.DateTimeFormat(locale, {
		weekday: 'short',
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		...(isDateOnly(value) ? {} : { hour: '2-digit', minute: '2-digit' })
	}).format(date);
}

/** Whether a date is recent enough for its relative label to change within the hour */
export const isRecent = (value: DateInput, now: Date | number = Date.now()) => {
	const date = toDate(value);
	return !!date && !isDateOnly(value) && Math.abs(new Date(now).getTime() - date.getTime()) < DAY;
};

/** `<time datetime>` value: the day for calendar dates, the ISO instant otherwise */
export const machineDate = (value: DateInput) => {
	if (isDateOnly(value)) return value;
	const date = toDate(value);
	return date && !Number.isNaN(date.getTime()) ? date.toISOString() : undefined;
};
