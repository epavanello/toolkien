import { dev } from '$app/env';
import { RUNNER_SHARED_SECRET, RUNNER_URL } from '$app/env/private';
import { createRunnerClient, type RunnerEndpoint } from './client.ts';
import { startLocalSupervisor } from './local.ts';
import type { RunnerClient } from './types.ts';

export type * from './types.ts';
export { createRunnerClient, type RunnerEndpoint } from './client.ts';

const LOCAL = Symbol.for('toolkien.runner.local');
type GlobalWithRunner = typeof globalThis & { [LOCAL]?: Promise<RunnerEndpoint> };

/**
 * `RUNNER_URL` + `RUNNER_SHARED_SECRET` → the runner container. In dev without them, a local
 * supervisor is started once with the `deno` binary (kept across HMR reloads).
 */
function endpoint(): Promise<RunnerEndpoint> {
	if (RUNNER_URL && RUNNER_SHARED_SECRET) {
		return Promise.resolve({ url: RUNNER_URL, secret: RUNNER_SHARED_SECRET });
	}
	if (!dev) return Promise.reject(new Error('RUNNER_URL and RUNNER_SHARED_SECRET are not set'));
	const g = globalThis as GlobalWithRunner;
	g[LOCAL] ??= startLocalSupervisor().catch((error: unknown) => {
		delete g[LOCAL];
		console.error('[runner] local supervisor failed to start:', error);
		throw error;
	});
	return g[LOCAL];
}

export const runner: RunnerClient = createRunnerClient(endpoint);
