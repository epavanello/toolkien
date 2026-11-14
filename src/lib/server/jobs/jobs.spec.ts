import { describe, expect, it } from 'vitest';
import { registerJob, runJob } from './index.ts';

describe('jobs', () => {
	it('never overlaps runs of the same job and survives failures', async () => {
		let runs = 0;
		let release!: () => void;
		registerJob({
			name: 'test.slow',
			intervalMs: 60_000,
			run: () => new Promise<void>((resolve) => ((release = resolve), runs++))
		});
		const first = runJob('test.slow');
		await runJob('test.slow');
		release();
		await first;
		expect(runs).toBe(1);

		registerJob({
			name: 'test.failing',
			intervalMs: 60_000,
			run: async () => {
				throw new Error('x');
			}
		});
		await expect(runJob('test.failing')).resolves.toBeUndefined();
	});
});
