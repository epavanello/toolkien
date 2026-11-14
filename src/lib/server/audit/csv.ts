import type { AuditEventView } from './types.ts';

/**
 * Pure CSV helpers for the admin export. Cells that a spreadsheet would read as a formula
 * (`=`, `+`, `-`, `@`, tab, CR) are prefixed with `'` (CSV injection), and every cell with a
 * quote, comma or newline is quoted.
 */
export function csvCell(value: unknown): string {
	if (value == null) return '';
	let text = value instanceof Date ? value.toISOString() : String(value);
	if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export const AUDIT_CSV_COLUMNS = [
	'occurred_at',
	'type',
	'outcome',
	'user_id',
	'user_name',
	'client',
	'connector_id',
	'tool',
	'execution_id',
	'duration_ms',
	'approved_by',
	'approver_user_id',
	'metadata'
] as const;

export function auditCsv(events: AuditEventView[]): string {
	const lines = [AUDIT_CSV_COLUMNS.join(',')];
	for (const event of events) {
		lines.push(
			[
				event.occurredAt,
				event.type,
				event.outcome,
				event.userId,
				event.userName,
				event.clientName ?? event.clientId,
				event.connectorId,
				event.toolPath,
				event.executionId,
				event.durationMs,
				event.approvedBy,
				event.approverUserId,
				event.metadata && Object.keys(event.metadata).length > 0
					? JSON.stringify(event.metadata)
					: null
			]
				.map(csvCell)
				.join(',')
		);
	}
	return `${lines.join('\r\n')}\r\n`;
}
