/**
 * In-memory job scheduler contract (owner: org-ops). Single instance only: jobs must be
 * idempotent and derive their work from the database, so a run missed during a restart is
 * picked up by the next one. Runs of one job never overlap; a failing run is logged (name
 * only) and never crashes the server. Not started during build or tests.
 */
export type JobDefinition = {
	/** Unique, e.g. `audit.retention`, `executions.expire` */
	name: string;
	intervalMs: number;
	/** Also run once right after `startJobs()` */
	runOnStart?: boolean;
	run: () => Promise<void>;
};

export interface JobScheduler {
	registerJob(job: JobDefinition): void;
	startJobs(): void;
	stopJobs(): void;
	/** Runs one job now (tests, admin panel) */
	runJob(name: string): Promise<void>;
}

/** A registered job and its last run, for the admin panel (additive, org-ops) */
export type JobStatus = {
	name: string;
	intervalMs: number;
	running: boolean;
	lastRunAt: Date | null;
	lastDurationMs: number | null;
	lastOk: boolean | null;
};
