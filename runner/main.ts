/**
 * Toolkien runner supervisor. Listens on the internal `sandbox` network; see `src/protocol.ts`.
 *
 *   deno task cache && deno task start
 */
import { loadConfig, prepareCheckerCache } from './src/config.ts';
import { typeCheck } from './src/job.ts';
import { createHandler } from './src/server.ts';

const config = await prepareCheckerCache(await loadConfig());

// Fail fast when the TypeScript package is not cached (it is never downloaded at runtime)
const scratch = await Deno.makeTempDir({ dir: config.scratchDir, prefix: 'warmup-' });
try {
	const warm = await typeCheck(config, { code: 'return 1;', declarations: '' }, scratch);
	if (!warm.ok) throw new Error(warm.diagnostics);
} catch (error) {
	console.error(
		JSON.stringify({
			event: 'startup.failed',
			error: `Type checker unavailable (run \`deno task cache\`): ${
				error instanceof Error ? error.message : error
			}`
		})
	);
	Deno.exit(1);
} finally {
	await Deno.remove(scratch, { recursive: true }).catch(() => {});
}

const controller = new AbortController();
const server = Deno.serve(
	{
		hostname: config.hostname,
		port: config.port,
		signal: controller.signal,
		onListen: ({ port }) => console.log(JSON.stringify({ event: 'listening', port }))
	},
	createHandler(config)
);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	try {
		Deno.addSignalListener(signal, () => controller.abort());
	} catch {
		// signals unsupported on this platform
	}
}

await server.finished;
