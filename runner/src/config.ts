/** Supervisor configuration from the environment (all optional except the shared secret). */

export type SupervisorConfig = {
	secret: string;
	hostname: string;
	/** 0 = pick a free port (dev/tests); the chosen port is printed on stdout */
	port: number;
	maxConcurrent: number;
	/** Parent of the per-job scratch directories (tmpfs in the container) */
	scratchDir: string;
	/** Deno binary used for the checker and the sandbox */
	denoPath: string;
	/** Deno cache holding the `typescript` npm package (read by the checker) */
	denoDir: string;
	/** Directory the checker may read (the cached `typescript` npm package) */
	typescriptDir: string;
	/**
	 * Writable DENO_DIR for the checker whose `npm/` links to the read-only cache, so V8 can keep
	 * the code cache of typescript.js (≈10x faster checks). Set by `prepareCheckerCache`.
	 */
	checkerDenoDir?: string;
	/** Upper bounds: the limits sent by the app are clamped to these */
	caps: {
		timeoutMs: number;
		memoryMb: number;
		maxOutputBytes: number;
		maxToolCalls: number;
		codeBytes: number;
		declarationsBytes: number;
		/** Largest single message from the sandbox (tool call arguments, result) */
		messageBytes: number;
	};
	checkTimeoutMs: number;
	checkMemoryMb: number;
	/** Linux only: RLIMIT_DATA for sandboxes in MB (caps ArrayBuffer memory outside the V8 heap) */
	dataLimitMb: number | null;
};

export const TYPESCRIPT_VERSION = '6.0.3';

function int(env: (name: string) => string | undefined, name: string, fallback: number): number {
	const raw = env(name);
	if (raw === undefined || raw === '') return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(`${name} must be a non-negative integer`);
	}
	return value;
}

export async function denoDir(denoPath: string): Promise<string> {
	const out = await new Deno.Command(denoPath, {
		args: ['info', '--json'],
		stdout: 'piped',
		stderr: 'null',
		env: { NO_COLOR: '1' }
	}).output();
	const info = JSON.parse(new TextDecoder().decode(out.stdout)) as { denoDir: string };
	return info.denoDir;
}

export async function loadConfig(
	env: (name: string) => string | undefined = (n) => Deno.env.get(n)
): Promise<SupervisorConfig> {
	const secret = env('RUNNER_SHARED_SECRET') ?? '';
	if (secret.length < 32) throw new Error('RUNNER_SHARED_SECRET must be at least 32 characters');
	const denoPath = env('RUNNER_DENO_PATH') || Deno.execPath();
	const cacheDir = env('DENO_DIR') || (await denoDir(denoPath));
	const typescriptDir =
		env('RUNNER_TYPESCRIPT_DIR') ||
		`${cacheDir}/npm/registry.npmjs.org/typescript/${TYPESCRIPT_VERSION}`;
	const dataLimit = int(env, 'RUNNER_DATA_LIMIT_MB', 0);
	return {
		secret,
		hostname: env('RUNNER_HOST') || '0.0.0.0',
		port: int(env, 'RUNNER_PORT', 8787),
		maxConcurrent: Math.max(1, int(env, 'RUNNER_MAX_CONCURRENT', 4)),
		scratchDir: env('RUNNER_SCRATCH_DIR') || env('TMPDIR') || '/tmp',
		denoPath,
		denoDir: cacheDir,
		typescriptDir,
		caps: {
			timeoutMs: int(env, 'RUNNER_MAX_TIMEOUT_MS', 300_000),
			memoryMb: int(env, 'RUNNER_MAX_MEMORY_MB', 512),
			maxOutputBytes: int(env, 'RUNNER_MAX_OUTPUT_BYTES', 1024 * 1024),
			maxToolCalls: int(env, 'RUNNER_MAX_TOOL_CALLS', 1000),
			codeBytes: int(env, 'RUNNER_MAX_CODE_BYTES', 256 * 1024),
			declarationsBytes: int(env, 'RUNNER_MAX_DECLARATIONS_BYTES', 4 * 1024 * 1024),
			messageBytes: int(env, 'RUNNER_MAX_MESSAGE_BYTES', 8 * 1024 * 1024)
		},
		checkTimeoutMs: int(env, 'RUNNER_CHECK_TIMEOUT_MS', 20_000),
		checkMemoryMb: int(env, 'RUNNER_CHECK_MEMORY_MB', 512),
		dataLimitMb: dataLimit > 0 ? dataLimit : null
	};
}

/** Creates `<scratch>/checker-deno-dir` with `npm/` symlinked to the (read-only) Deno cache */
export async function prepareCheckerCache(config: SupervisorConfig): Promise<SupervisorConfig> {
	const dir = `${config.scratchDir}/checker-deno-dir`;
	await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
	await Deno.remove(`${dir}/npm`).catch(() => {});
	await Deno.symlink(`${config.denoDir}/npm`, `${dir}/npm`);
	return { ...config, checkerDenoDir: dir };
}
