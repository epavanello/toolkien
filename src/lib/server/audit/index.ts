import { db } from '#lib/server/db/index.ts';
import { auditEvent } from '#lib/server/db/schema/index.ts';
import { notImplemented } from '#lib/server/not-implemented.ts';
import type { AuditService } from './types.ts';

export type * from './types.ts';

export const record: AuditService['record'] = async (event) => {
	try {
		await db.insert(auditEvent).values(event);
	} catch {
		console.error(`[audit] failed to record ${event.type}`);
	}
};

export const query: AuditService['query'] = async () => notImplemented('audit.query');
export const purgeOlderThan: AuditService['purgeOlderThan'] = async () =>
	notImplemented('audit.purgeOlderThan');
