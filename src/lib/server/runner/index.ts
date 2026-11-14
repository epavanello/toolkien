import { notImplemented } from '#lib/server/not-implemented.ts';
import type { RunnerClient } from './types.ts';

export type * from './types.ts';

export const runner: RunnerClient = {
	run: async () => notImplemented('runner.run'),
	health: async () => false
};
