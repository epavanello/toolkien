import {
	AUDIT_RETENTION_DAYS,
	EXEC_MAX_OUTPUT_BYTES,
	EXEC_MAX_TOOL_CALLS,
	EXEC_TIMEOUT_MS,
	RATE_LIMIT_EXEC_PER_MIN
} from '$app/env/private';
import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { record } from '#lib/server/audit/index.ts';
import { db } from '#lib/server/db/index.ts';
import { platformSetting } from '#lib/server/db/schema/index.ts';
import type { ExtendedLimits, LimitKey } from './types.ts';

const SETTING_KEY = 'limits';
const CACHE_MS = 30_000;

/** Env defaults (and code defaults for limits without an env var) */
export const defaultLimits = (): ExtendedLimits => ({
	execTimeoutMs: EXEC_TIMEOUT_MS,
	execMaxToolCalls: EXEC_MAX_TOOL_CALLS,
	execMaxOutputBytes: EXEC_MAX_OUTPUT_BYTES,
	rateLimitExecPerMin: RATE_LIMIT_EXEC_PER_MIN,
	rateLimitWorkspaceExecPerMin: 600,
	rateLimitIpPerMin: 120,
	maxConcurrentPerUser: 4,
	maxConcurrentGlobal: 32,
	maxQueuedPerUser: 16,
	auditRetentionDays: AUDIT_RETENTION_DAYS
});

/** Admin-editable limits with their bounds (validation and the admin form) */
export const LIMIT_FIELDS: Record<LimitKey, { label: string; min: number; max: number }> = {
	execTimeoutMs: { label: 'Execution timeout (ms)', min: 1_000, max: 15 * 60_000 },
	execMaxToolCalls: { label: 'Tool calls per execution', min: 1, max: 10_000 },
	execMaxOutputBytes: { label: 'Output per execution (bytes)', min: 1_024, max: 10_485_760 },
	rateLimitExecPerMin: { label: 'Executions per user per minute', min: 1, max: 10_000 },
	rateLimitWorkspaceExecPerMin: {
		label: 'Executions per workspace per minute',
		min: 1,
		max: 100_000
	},
	rateLimitIpPerMin: { label: 'Executions per IP per minute', min: 1, max: 100_000 },
	maxConcurrentPerUser: { label: 'Concurrent executions per user', min: 1, max: 256 },
	maxConcurrentGlobal: { label: 'Concurrent executions (global)', min: 1, max: 4_096 },
	maxQueuedPerUser: { label: 'Queued executions per user', min: 0, max: 1_000 },
	auditRetentionDays: { label: 'Audit retention (days)', min: 1, max: 3_650 }
};

let cached: { at: number; limits: ExtendedLimits } | null = null;

/** Pure: overrides that are known keys with integers inside the bounds; the rest is ignored */
export function mergeLimits(base: ExtendedLimits, overrides: unknown): ExtendedLimits {
	const merged = { ...base };
	if (!overrides || typeof overrides !== 'object') return merged;
	for (const [key, value] of Object.entries(overrides)) {
		const field = LIMIT_FIELDS[key as LimitKey];
		if (field && Number.isInteger(value) && value >= field.min && value <= field.max) {
			merged[key as LimitKey] = value;
		}
	}
	return merged;
}

export async function getExtendedLimits(): Promise<ExtendedLimits> {
	if (cached && Date.now() - cached.at < CACHE_MS) return cached.limits;
	let overrides: unknown = null;
	try {
		const [row] = await db
			.select({ value: platformSetting.value })
			.from(platformSetting)
			.where(eq(platformSetting.key, SETTING_KEY))
			.limit(1);
		overrides = row?.value ?? null;
	} catch {
		console.error('[limits] could not read the limits setting, using defaults');
	}
	const limits = mergeLimits(defaultLimits(), overrides);
	cached = { at: Date.now(), limits };
	return limits;
}

/** Last known limits without a database round trip (hot paths); defaults before the first load */
export const currentLimits = (): ExtendedLimits => cached?.limits ?? defaultLimits();

/** Stores overrides (platform admins). Keys equal to the default are dropped. */
export async function updateLimits(actorUserId: string, patch: Partial<ExtendedLimits>) {
	const defaults = defaultLimits();
	const overrides: Partial<ExtendedLimits> = {};
	for (const [key, value] of Object.entries(patch)) {
		const field = LIMIT_FIELDS[key as LimitKey];
		if (!field || value === undefined) continue;
		if (!Number.isInteger(value) || value < field.min || value > field.max) {
			error(400, `${field.label} must be between ${field.min} and ${field.max}.`, {
				code: 'INVALID_INPUT'
			});
		}
		if (value !== defaults[key as LimitKey]) overrides[key as LimitKey] = value;
	}
	await db
		.insert(platformSetting)
		.values({ key: SETTING_KEY, value: overrides, updatedBy: actorUserId })
		.onConflictDoUpdate({
			target: platformSetting.key,
			set: { value: overrides, updatedBy: actorUserId }
		});
	cached = null;
	await record({
		type: 'platform.limits_changed',
		outcome: 'success',
		userId: actorUserId,
		metadata: { overrides: Object.keys(overrides).length }
	});
	return getExtendedLimits();
}
