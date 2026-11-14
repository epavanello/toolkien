import type { JobDefinition, JobScheduler } from './types.ts';

export type * from './types.ts';

const jobs = new Map<string, JobDefinition>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
const running = new Set<string>();

export const runJob: JobScheduler['runJob'] = async (name) => {
	const job = jobs.get(name);
	if (!job || running.has(name)) return;
	running.add(name);
	try {
		await job.run();
	} catch {
		console.error(`[jobs] ${name} failed`);
	} finally {
		running.delete(name);
	}
};

export const registerJob: JobScheduler['registerJob'] = (job) => {
	if (jobs.has(job.name)) throw new Error(`Job already registered: ${job.name}`);
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
