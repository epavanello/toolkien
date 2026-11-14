import type { JobDefinition, JobScheduler, JobStatus } from './types.ts';

const jobs = new Map<string, JobDefinition>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
const running = new Set<string>();
const history = new Map<string, { lastRunAt: Date; lastDurationMs: number; lastOk: boolean }>();

export const runJob: JobScheduler['runJob'] = async (name) => {
	const job = jobs.get(name);
	if (!job || running.has(name)) return;
	running.add(name);
	const started = Date.now();
	let ok = true;
	try {
		await job.run();
	} catch {
		ok = false;
		console.error(`[jobs] ${name} failed`);
	} finally {
		running.delete(name);
		history.set(name, {
			lastRunAt: new Date(started),
			lastDurationMs: Date.now() - started,
			lastOk: ok
		});
	}
};

/**
 * Registers (or, with the same name, replaces) a job. Replacing keeps the timer: dev HMR
 * re-evaluates `builtin.ts` while this module and its timers live on.
 */
export const registerJob: JobScheduler['registerJob'] = (job) => {
	jobs.set(job.name, job);
};

export const startJobs: JobScheduler['startJobs'] = () => {
	for (const job of jobs.values()) {
		if (timers.has(job.name)) continue;
		timers.set(
			job.name,
			setInterval(() => void runJob(job.name), job.intervalMs)
		);
		if (job.runOnStart) void runJob(job.name);
	}
};

export const stopJobs: JobScheduler['stopJobs'] = () => {
	for (const timer of timers.values()) clearInterval(timer);
	timers.clear();
};

/** Registered jobs with their last run (admin panel) */
export function listJobs(): JobStatus[] {
	return [...jobs.values()].map((job) => ({
		name: job.name,
		intervalMs: job.intervalMs,
		running: running.has(job.name),
		lastRunAt: history.get(job.name)?.lastRunAt ?? null,
		lastDurationMs: history.get(job.name)?.lastDurationMs ?? null,
		lastOk: history.get(job.name)?.lastOk ?? null
	}));
}
