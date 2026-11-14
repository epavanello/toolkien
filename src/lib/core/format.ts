import { format, formatDistanceToNowStrict } from 'date-fns';

type DateInput = Date | string | number | null | undefined;

const toDate = (value: DateInput) => (value == null ? null : new Date(value));

/** `2026-11-14 10:32:05` in the viewer's time zone; `—` for missing values */
export function formatDateTime(value: DateInput): string {
	const date = toDate(value);
	return date && !Number.isNaN(date.getTime()) ? format(date, 'yyyy-MM-dd HH:mm:ss') : '—';
}

/** `5 minutes ago` / `in 3 days` */
export function formatRelative(value: DateInput): string {
	const date = toDate(value);
	return date && !Number.isNaN(date.getTime())
		? formatDistanceToNowStrict(date, { addSuffix: true })
		: '—';
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
