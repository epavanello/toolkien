import { and, asc, eq, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { organization, usageDaily } from '#lib/server/db/schema/index.ts';
import type { UsageDelta, UsageRow } from './types.ts';

/** `YYYY-MM-DD` of `date` in UTC */
export const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

/**
 * Adds to today's counters of a workspace (called by the executions module: one execution
 * started/failed, tool calls, approvals, runtime). Pricing is free; usage is still recorded.
 */
export async function recordUsage(workspaceId: string, delta: UsageDelta, now = new Date()) {
	const values = {
		executions: delta.executions ?? 0,
		failedExecutions: delta.failedExecutions ?? 0,
		toolCalls: delta.toolCalls ?? 0,
		approvalsRequested: delta.approvalsRequested ?? 0,
		executionMs: Math.round(delta.executionMs ?? 0)
	};
	try {
		await db
			.insert(usageDaily)
			.values({ workspaceId, day: utcDay(now), ...values })
			.onConflictDoUpdate({
				target: [usageDaily.workspaceId, usageDaily.day],
				set: {
					executions: sql`${usageDaily.executions} + ${values.executions}`,
					failedExecutions: sql`${usageDaily.failedExecutions} + ${values.failedExecutions}`,
					toolCalls: sql`${usageDaily.toolCalls} + ${values.toolCalls}`,
					approvalsRequested: sql`${usageDaily.approvalsRequested} + ${values.approvalsRequested}`,
					executionMs: sql`${usageDaily.executionMs} + ${values.executionMs}`
				}
			});
	} catch {
		console.error('[limits] failed to record usage');
	}
}

/** Daily rows between two UTC days (inclusive), optionally for one workspace */
export async function getUsage(options: {
	workspaceId?: string;
	from: string;
	to: string;
}): Promise<UsageRow[]> {
	const where: SQL[] = [gte(usageDaily.day, options.from), lte(usageDaily.day, options.to)];
	if (options.workspaceId) where.push(eq(usageDaily.workspaceId, options.workspaceId));
	return db
		.select()
		.from(usageDaily)
		.where(and(...where))
		.orderBy(asc(usageDaily.day));
}

/** Pure: sums usage rows */
export function sumUsage(rows: UsageDelta[]): Required<UsageDelta> {
	const total = {
		executions: 0,
		failedExecutions: 0,
		toolCalls: 0,
		approvalsRequested: 0,
		executionMs: 0
	};
	for (const row of rows) {
		for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += row[key] ?? 0;
	}
	return total;
}

/** Totals per workspace over a period, busiest first (platform admin) */
export async function usageByWorkspace(from: string, to: string, limit = 50) {
	return db
		.select({
			workspaceId: usageDaily.workspaceId,
			name: organization.name,
			kind: organization.kind,
			executions: sql<number>`sum(${usageDaily.executions})`,
			failedExecutions: sql<number>`sum(${usageDaily.failedExecutions})`,
			toolCalls: sql<number>`sum(${usageDaily.toolCalls})`,
			executionMs: sql<number>`sum(${usageDaily.executionMs})`
		})
		.from(usageDaily)
		.leftJoin(organization, eq(organization.id, usageDaily.workspaceId))
		.where(and(gte(usageDaily.day, from), lte(usageDaily.day, to)))
		.groupBy(usageDaily.workspaceId)
		.orderBy(sql`sum(${usageDaily.executions}) desc`)
		.limit(limit);
}
