import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { RunnerEndpoint } from './client.ts';

export type LocalSupervisor = RunnerEndpoint & { stop(): Promise<void> };

export type LocalSupervisorOptions = {
	/** Deno binary (default `deno` from PATH) */
	deno?: string;
	/** The `runner/` directory (default `<cwd>/runner`) */
	runnerDir?: string;
	/** Extra `RUNNER_*` variables (limits, concurrency) */
	env?: Record<string, string>;
	startTimeoutMs?: number;
};

const pick = (env: NodeJS.ProcessEnv, names: string[]) =>
	Object.fromEntries(names.flatMap((n) => (env[n] ? [[n, env[n]]] : [])));

function exec(command: string, args: string[], cwd: string): Promise<void> {
	return new Promise((done, fail) => {
		const child = spawn(command, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
		child.on('error', fail);
		child.on('exit', (code) =>
			code === 0 ? done() : fail(new Error(`${command} ${args[0]} exited with ${code}`))
		);
	});
}

/**
 * Dev and test mode: starts the supervisor with the local `deno` binary on 127.0.0.1, a random
 * port and a random secret. Production uses the `runner` container (`RUNNER_URL`).
 */
export async function startLocalSupervisor(
	options: LocalSupervisorOptions = {}
): Promise<LocalSupervisor> {
	const deno = options.deno ?? 'deno';
	const cwd = options.runnerDir ?? resolve(process.cwd(), 'runner');
	const secret = randomBytes(32).toString('hex');

	// The checker never downloads at runtime (`--cached-only`): warm the cache first
	await exec(deno, ['cache', 'src/checker.ts'], cwd);

	const child: ChildProcess = spawn(
		deno,
		[
			'run',
			'--no-prompt',
			'--allow-net=127.0.0.1',
			'--allow-env',
			'--allow-read',
			'--allow-write',
			'--allow-run',
			'main.ts'
		],
		{
			cwd,
			// Only what Deno needs: the app's own secrets never reach the supervisor
			env: {
				...pick(process.env, ['PATH', 'HOME', 'DENO_DIR', 'TMPDIR', 'XDG_CACHE_HOME']),
				...options.env,
				RUNNER_SHARED_SECRET: secret,
				RUNNER_HOST: '127.0.0.1',
				RUNNER_PORT: '0'
			},
			stdio: ['ignore', 'pipe', 'inherit']
		}
	);

	const port = await new Promise<number>((done, fail) => {
		const timer = setTimeout(
			() => fail(new Error('Runner supervisor did not start in time')),
			options.startTimeoutMs ?? 30_000
		);
		const lines = createInterface({ input: child.stdout! });
		lines.on('line', (line) => {
			try {
				const event = JSON.parse(line) as { event?: string; port?: number };
				if (event.event === 'listening' && event.port) {
					clearTimeout(timer);
					done(event.port);
				}
			} catch {
				// not a JSON event
			}
		});
		child.on('error', (error) => {
			clearTimeout(timer);
			fail(error);
		});
		child.on('exit', (code) => {
			clearTimeout(timer);
			fail(new Error(`Runner supervisor exited with code ${code}`));
		});
	});

	const onExit = () => child.kill('SIGKILL');
	process.once('exit', onExit);

	return {
		url: `http://127.0.0.1:${port}`,
		secret,
		stop: () =>
			new Promise<void>((done) => {
				process.off('exit', onExit);
				if (child.exitCode !== null || child.signalCode !== null) return done();
				child.once('exit', () => done());
				child.kill('SIGTERM');
			})
	};
}
