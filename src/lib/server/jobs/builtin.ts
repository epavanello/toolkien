/**
 * Jobs registered at server start. `hooks.server.ts` imports `#lib/server/jobs/index.ts`, which
 * imports this file, so every job listed here exists before `startJobs()`. Other verticals add
 * their job registrations here (one import + `registerJob`), keeping modules free of import-time
 * side effects.
 */
import { purgeOlderThan } from '#lib/server/audit/index.ts';
import { getExtendedLimits, pruneRateLimits } from '#lib/server/limits/index.ts';
import { purgeScheduledDeletions } from '#lib/server/workspaces/index.ts';
import { registerJob } from './scheduler.ts';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

registerJob({
	name: 'audit.retention',
	intervalMs: 24 * HOUR,
	runOnStart: true,
	run: async () => {
		const { auditRetentionDays } = await getExtendedLimits();
		const deleted = await purgeOlderThan(auditRetentionDays);
		if (deleted > 0) console.info(`[jobs] audit.retention deleted ${deleted} events`);
	}
});

registerJob({
	name: 'workspaces.purge',
	intervalMs: HOUR,
	runOnStart: true,
	run: async () => {
		const purged = await purgeScheduledDeletions();
		if (purged > 0) console.info(`[jobs] workspaces.purge deleted ${purged} workspaces`);
	}
});

registerJob({
	name: 'limits.prune',
	intervalMs: 5 * MINUTE,
	run: async () => {
		pruneRateLimits();
	}
});
