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

// Dynamic import: the executions module pulls connectors/crypto, which import this scheduler
registerJob({
	name: 'executions.expire',
	intervalMs: MINUTE,
	runOnStart: true,
	run: async () => {
		const { expireStale } = await import('#lib/server/executions/index.ts');
		await expireStale();
	}
});

registerJob({
	name: 'connectors.oauth_flows',
	intervalMs: HOUR,
	run: async () => {
		const { purgeExpiredFlows } = await import('#lib/server/connectors/index.ts');
		await purgeExpiredFlows();
	}
});

// Hourly, a few connectors per run: daily resync of upstreams that do not announce
// `tools/list_changed` (see `connectors/resync.ts`)
registerJob({
	name: 'connectors.resync',
	intervalMs: HOUR,
	runOnStart: true,
	run: async () => {
		const { resyncStaleConnectors } = await import('#lib/server/connectors/index.ts');
		const synced = await resyncStaleConnectors();
		if (synced > 0) console.info(`[jobs] connectors.resync synced ${synced} connectors`);
	}
});

// Daily, idempotent: a no-op until the transit key is rotated, then it moves every wrapped DEK
// to the new key version so `min_decryption_version` can be raised.
registerJob({
	name: 'crypto.rewrap',
	intervalMs: 24 * HOUR,
	run: async () => {
		const { rewrapAllWorkspaces } = await import('#lib/server/crypto/index.ts');
		await rewrapAllWorkspaces();
	}
});
