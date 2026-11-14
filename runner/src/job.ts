/**
 * One execution: type-check in a sandboxed checker process, then run the script in a fresh
 * `deno run` with no permissions, relaying tool calls to the app.
 */
import type { SupervisorConfig } from './config.ts';
import { excerpt } from './excerpt.ts';
import { byteLength, completedOutput, LogBuffer, truncateBytes } from './output.ts';
import type {
	ChildToSupervisor,
	RunnerFailureCode,
	RunnerJob,
	RunnerLimits,
	RunnerResult,
	SupervisorToChild,
	ToolCallResponse
} from './protocol.ts';

const CHECKER = new URL('./checker.ts', import.meta.url);
const CONFIG_PATH = new URL('../deno.json', import.meta.url).pathname;
const PRELUDE = await Deno.readTextFile(new URL('./sandbox/prelude.js', import.meta.url));
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const TOOL_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*\.[A-Za-z_$][A-Za-z0-9_$]*$/;
const STDERR_TAIL_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type JobIO = {
	/** Forward a tool call to the app */
	toolCall(call: { seq: number; path: string; args: unknown }): void;
};

type CheckOutput =
	{ ok: true; js: string; namespaces: string[] } | { ok: false; diagnostics: string };

export function clampLimits(limits: RunnerLimits, caps: SupervisorConfig['caps']): RunnerLimits {
	return {
		timeoutMs: Math.min(limits.timeoutMs, caps.timeoutMs),
		maxToolCalls: Math.min(limits.maxToolCalls, caps.maxToolCalls),
		maxOutputBytes: Math.min(limits.maxOutputBytes, caps.maxOutputBytes),
		memoryMb: Math.max(16, Math.min(limits.memoryMb, caps.memoryMb))
	};
}

/** Environment of every child: nothing from the supervisor (no secret, no PATH) */
function childEnv(denoDir: string): Record<string, string> {
	return { DENO_DIR: denoDir, NO_COLOR: '1', DENO_NO_UPDATE_CHECK: '1' };
}

/** Wraps the command in `ulimit -d` on Linux when a data limit is configured */
function command(config: SupervisorConfig, args: string[], dataLimitMb: number | null) {
	if (dataLimitMb && Deno.build.os === 'linux') {
		return {
			cmd: '/bin/sh',
			args: ['-c', `ulimit -d ${dataLimitMb * 1024} && exec "$0" "$@"`, config.denoPath, ...args]
		};
	}
	return { cmd: config.denoPath, args };
}

async function readAll(
	stream: ReadableStream<Uint8Array>,
	max: number
): Promise<{ text: string; overflow: boolean }> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	let overflow = false;
	for await (const chunk of stream) {
		if (size + chunk.length > max) {
			overflow = true;
			continue;
		}
		chunks.push(chunk);
		size += chunk.length;
	}
	const all = new Uint8Array(size);
	let offset = 0;
	for (const c of chunks) {
		all.set(c, offset);
		offset += c.length;
	}
	return { text: decoder.decode(all), overflow };
}

/** Keeps only the last `max` bytes of a stream (stderr: crash and OOM diagnostics) */
async function tail(stream: ReadableStream<Uint8Array>, max: number): Promise<string> {
	let buffer = new Uint8Array(0);
	for await (const chunk of stream) {
		const next = new Uint8Array(Math.min(max, buffer.length + chunk.length));
		const merged = new Uint8Array(buffer.length + chunk.length);
		merged.set(buffer);
		merged.set(chunk, buffer.length);
		next.set(merged.subarray(merged.length - next.length));
		buffer = next;
	}
	return decoder.decode(buffer);
}

/**
 * Flags of the sandbox process: no `--allow-*` at all (every permission is denied without a
 * prompt), explicit denies as a second line, no remote/npm/config resolution, V8 heap limit and
 * no `eval` / `new Function` (so `import()` cannot be smuggled past the checker in a string).
 */
export function sandboxFlags(memoryMb: number): string[] {
	return [
		'--no-prompt',
		'--no-remote',
		'--no-npm',
		'--no-config',
		'--no-lock',
		'--no-code-cache',
		'--cached-only',
		'--deny-read',
		'--deny-net',
		'--deny-env',
		'--deny-write',
		'--deny-run',
		'--deny-sys',
		'--deny-ffi',
		'--deny-import',
		`--v8-flags=--max-old-space-size=${memoryMb},--disallow-code-generation-from-strings`
	];
}

export async function typeCheck(
	config: SupervisorConfig,
	input: { code: string; declarations: string },
	cwd: string
): Promise<CheckOutput> {
	// The package as seen through the checker's DENO_DIR (symlink) and its real location
	const readable = [config.typescriptDir];
	if (config.checkerDenoDir && config.typescriptDir.startsWith(`${config.denoDir}/npm/`))
		readable.push(
			`${config.checkerDenoDir}/npm${config.typescriptDir.slice(`${config.denoDir}/npm`.length)}`
		);
	const { cmd, args } = command(
		config,
		[
			'run',
			'--no-prompt',
			'--cached-only',
			// Resolve `npm:typescript` from deno.lock (pinned + integrity), not from the packument
			'--config',
			CONFIG_PATH,
			'--frozen',
			'--no-remote',
			`--allow-read=${readable.join(',')}`,
			'--allow-env',
			'--deny-net',
			'--deny-write',
			'--deny-run',
			'--deny-sys',
			'--deny-ffi',
			`--v8-flags=--max-old-space-size=${config.checkMemoryMb}`,
			CHECKER.href
		],
		null
	);
	const child = new Deno.Command(cmd, {
		args,
		cwd,
		clearEnv: true,
		env: childEnv(config.checkerDenoDir ?? config.denoDir),
		stdin: 'piped',
		stdout: 'piped',
		stderr: 'piped'
	}).spawn();
	const timer = setTimeout(() => {
		try {
			child.kill('SIGKILL');
		} catch {
			// already exited
		}
	}, config.checkTimeoutMs);
	try {
		const writer = child.stdin.getWriter();
		await writer.write(encoder.encode(JSON.stringify(input)));
		await writer.close();
		const [out, err, status] = await Promise.all([
			readAll(child.stdout, 32 * 1024 * 1024),
			tail(child.stderr, STDERR_TAIL_BYTES),
			child.status
		]);
		if (status.success && !out.overflow) return JSON.parse(out.text) as CheckOutput;
		if (status.signal === 'SIGKILL') {
			return { ok: false, diagnostics: 'Type checking took too long; simplify the script.' };
		}
		if (/out of memory|heap limit/i.test(err)) {
			return { ok: false, diagnostics: 'Type checking ran out of memory; simplify the script.' };
		}
		throw new Error(`checker exited with code ${status.code}`);
	} finally {
		clearTimeout(timer);
	}
}

/** What the agent should do about an uncaught tool error, by code */
const TOOL_ERROR_HINTS: Record<string, string> = {
	upstream_error:
		'The tool itself reported this error (text from the server). Fix the arguments or the request; wrap the call in try/catch to continue past it.',
	invalid_params:
		'The server rejected the arguments: compare them with the declaration (tools_describe); the current signature is included above when it changed.',
	unknown_tool: 'The tool no longer exists upstream: run tools_search again.',
	auth_required:
		'The connector needs the user to sign in again: ask them to reconnect it in Toolkien (Connectors). Do not retry until they have.',
	timeout: 'The upstream server did not answer in time. Retry later or ask for less data per call.',
	blocked:
		'This tool is blocked by the workspace permissions. Do not retry: tell the user, who can change it in Toolkien (Permissions) if they want.',
	approval_rejected:
		'The user rejected this call. Do not retry it; ask the user how they want to proceed.',
	limit_tool_calls:
		'Too many tool calls in one execution (limit: maxToolCalls). Batch the work or split it across executions.',
	outcome_unknown:
		'The call was interrupted and may or may not have happened upstream: check its effect before trying again.',
	replay_mismatch:
		'A resumed script must make the same calls with the same arguments, in the same order, up to the call that was approved.',
	suspended: 'Access is suspended (kill switch). Ask the user or a workspace admin.'
};

const STACK_FRAME = /script\.ts:(\d+):(\d+)/;

/**
 * An uncaught error for the agent: `Name: message`, the script location (inline source map →
 * `script.ts:<line>:<col>` of the wrapped code, mapped back to the agent's lines) with the code
 * line and a caret, the script frames of the stack, and a hint for tool errors.
 */
export function formatRuntimeError(
	frame: { name?: unknown; message?: unknown; stack?: unknown; code?: unknown; path?: unknown },
	code: string
): string {
	const name = typeof frame.name === 'string' ? frame.name.slice(0, 100) : 'Error';
	const message = typeof frame.message === 'string' ? truncateBytes(frame.message, 8192) : '';
	const lines = [`${name}: ${message}`];
	const codeLines = code.split('\n');
	const stack = typeof frame.stack === 'string' ? frame.stack.split('\n') : [];
	const frames: { line: number; column: number; fn?: string }[] = [];
	for (const entry of stack) {
		const match = STACK_FRAME.exec(entry);
		if (!match) continue;
		// The wrapper adds one line before the agent's code
		const line = Number(match[1]) - 1;
		if (line < 1 || line > codeLines.length) continue;
		const fn = /at (?:async )?([\w$.<>]+) \(/.exec(entry)?.[1];
		frames.push({ line, column: Number(match[2]), fn });
	}
	if (frames.length > 0) {
		const [top, ...callers] = frames;
		lines.push(`  at script.ts:${top.line}:${top.column}`);
		lines.push(...excerpt(codeLines[top.line - 1] ?? '', top.column - 1));
		for (const f of callers.slice(0, 5)) {
			const where = `script.ts:${f.line}:${f.column}`;
			lines.push(`  at ${f.fn && f.fn !== '__toolkienMain' ? `${f.fn} (${where})` : where}`);
		}
	}
	if (name === 'ToolCallError' && typeof frame.code === 'string') {
		const hint = TOOL_ERROR_HINTS[frame.code];
		if (hint) lines.push(`  hint: ${hint}`);
	}
	return lines.join('\n');
}

export class JobRun {
	readonly limits: RunnerLimits;
	#config: SupervisorConfig;
	#job: RunnerJob;
	#io: JobIO;
	#logs: LogBuffer;
	#child: Deno.ChildProcess | null = null;
	#stdin: WritableStreamDefaultWriter<Uint8Array> | null = null;
	#scratch: string | null = null;
	#timer: ReturnType<typeof setTimeout> | undefined;
	#calls = 0;
	/** seq → sandbox call id, for calls waiting for the app */
	#pending = new Map<number, number>();
	#finished = false;
	#resolve!: (result: RunnerResult) => void;
	readonly done: Promise<RunnerResult>;

	constructor(job: RunnerJob, config: SupervisorConfig, io: JobIO) {
		this.#job = job;
		this.#config = config;
		this.#io = io;
		this.limits = clampLimits(job.limits, config.caps);
		this.#logs = new LogBuffer(this.limits.maxOutputBytes);
		this.done = new Promise((resolve) => (this.#resolve = resolve));
	}

	#logsText(): string {
		return this.#logs.text(this.limits.maxOutputBytes, this.limits.maxOutputBytes).logs;
	}

	#fail(code: RunnerFailureCode, message: string) {
		this.#finish({ status: 'failed', code, message, logs: this.#logsText() });
	}

	#finish(result: RunnerResult) {
		if (this.#finished) return;
		this.#finished = true;
		clearTimeout(this.#timer);
		this.#pending.clear();
		if (this.#child) {
			try {
				this.#child.kill('SIGKILL');
			} catch {
				// already exited
			}
		}
		this.#resolve(result);
		void this.#cleanup();
	}

	async #cleanup() {
		if (this.#child) await this.#child.status.catch(() => {});
		if (this.#scratch) await Deno.remove(this.#scratch, { recursive: true }).catch(() => {});
	}

	/** Runs the job to completion; the same promise as `done` */
	async start(): Promise<RunnerResult> {
		const { code, declarations } = this.#job;
		const caps = this.#config.caps;
		if (byteLength(code) > caps.codeBytes) {
			this.#fail('type_error', `The script is larger than ${caps.codeBytes} bytes.`);
			return this.done;
		}
		if (byteLength(declarations) > caps.declarationsBytes) {
			this.#fail('runtime_error', 'The tool declarations are too large.');
			return this.done;
		}
		try {
			this.#scratch = await Deno.makeTempDir({ dir: this.#config.scratchDir, prefix: 'job-' });
			const checked = await typeCheck(this.#config, { code, declarations }, this.#scratch);
			if (this.#finished) return this.done;
			if (!checked.ok) {
				this.#fail('type_error', checked.diagnostics);
				return this.done;
			}
			await this.#spawn(
				checked.js,
				checked.namespaces.filter((n) => IDENTIFIER.test(n))
			);
		} catch (error) {
			console.error(
				JSON.stringify({
					event: 'job.error',
					executionId: this.#job.executionId,
					error: error instanceof Error ? error.message : 'unknown'
				})
			);
			this.#fail('runner_unavailable', 'The runner could not start the script.');
		}
		return this.done;
	}

	async #spawn(js: string, namespaces: string[]) {
		const dir = this.#scratch!;
		await Deno.writeTextFile(`${dir}/prelude.js`, PRELUDE);
		await Deno.writeTextFile(`${dir}/script.js`, js);
		const options = JSON.stringify({
			namespaces,
			maxOutputBytes: this.limits.maxOutputBytes,
			maxMessageBytes: this.#config.caps.messageBytes
		});
		await Deno.writeTextFile(
			`${dir}/entry.js`,
			`import { run } from './prelude.js';\nimport main from './script.js';\nawait run(main, ${options});\n`
		);
		if (this.#finished) return;
		const { cmd, args } = command(
			this.#config,
			['run', ...sandboxFlags(this.limits.memoryMb), `${dir}/entry.js`],
			this.#config.dataLimitMb
		);
		const child = new Deno.Command(cmd, {
			args,
			cwd: dir,
			clearEnv: true,
			env: childEnv(`${dir}/.deno`),
			stdin: 'piped',
			stdout: 'piped',
			stderr: 'piped'
		}).spawn();
		this.#child = child;
		this.#stdin = child.stdin.getWriter();
		this.#timer = setTimeout(
			() =>
				this.#fail('timeout', `The script exceeded the ${this.limits.timeoutMs} ms time limit.`),
			this.limits.timeoutMs
		);
		const stderr = tail(child.stderr, STDERR_TAIL_BYTES);
		await this.#readFrames(child.stdout);
		const status = await child.status;
		if (this.#finished) return;
		const err = await stderr;
		if (/out of memory|heap limit|allocation failed/i.test(err) || status.signal === 'SIGTRAP') {
			this.#fail('memory', `The script exceeded the ${this.limits.memoryMb} MB memory limit.`);
			return;
		}
		const detail = truncateBytes(err.split(dir).join('<sandbox>').trim(), 2048);
		this.#fail(
			'runtime_error',
			`The script process exited unexpectedly (${status.signal ?? `code ${status.code}`}).${
				detail ? `\n${detail}` : ''
			}`
		);
	}

	async #readFrames(stream: ReadableStream<Uint8Array>) {
		const max = this.#config.caps.messageBytes;
		let parts: Uint8Array[] = [];
		let size = 0;
		const reader = stream.getReader();
		try {
			for (;;) {
				const { value, done } = await reader.read();
				if (done || this.#finished) return;
				let start = 0;
				for (let i = 0; i < value.length; i++) {
					if (value[i] !== 10) continue;
					parts.push(value.subarray(start, i));
					size += i - start;
					start = i + 1;
					if (size > max) return this.#tooLarge(max);
					const line = new Uint8Array(size);
					let offset = 0;
					for (const p of parts) {
						line.set(p, offset);
						offset += p.length;
					}
					parts = [];
					size = 0;
					if (line.length > 0) this.#onFrame(decoder.decode(line));
					if (this.#finished) return;
				}
				if (start < value.length) {
					parts.push(value.slice(start));
					size += value.length - start;
					if (size > max) return this.#tooLarge(max);
				}
			}
		} finally {
			reader.releaseLock();
		}
	}

	#tooLarge(max: number) {
		this.#fail(
			'runtime_error',
			`A tool call's arguments or the script's output exceeded the ${max}-byte message limit (limit: messageBytes). Send or return less data at once.`
		);
	}

	#onFrame(line: string) {
		let frame: ChildToSupervisor;
		try {
			frame = JSON.parse(line);
		} catch {
			return this.#fail('runtime_error', 'Sandbox protocol error.');
		}
		switch (frame?.t) {
			case 'log':
				if (typeof frame.text === 'string') this.#logs.push(frame.text);
				return;
			case 'call': {
				if (
					!Number.isInteger(frame.id) ||
					typeof frame.path !== 'string' ||
					!TOOL_PATH.test(frame.path)
				) {
					return this.#fail('runtime_error', 'Sandbox protocol error.');
				}
				this.#calls += 1;
				if (this.#calls > this.limits.maxToolCalls) {
					return this.#fail(
						'limit_tool_calls',
						`The script exceeded the limit of ${this.limits.maxToolCalls} tool calls.`
					);
				}
				const seq = this.#calls;
				this.#pending.set(seq, frame.id);
				this.#io.toolCall({ seq, path: frame.path, args: frame.args ?? {} });
				return;
			}
			case 'done': {
				if (typeof frame.json !== 'string') {
					return this.#fail('runtime_error', 'Sandbox protocol error.');
				}
				const out = completedOutput(
					{ json: frame.json, size: Number(frame.size) || 0, truncated: frame.truncated === true },
					this.#logs,
					this.limits.maxOutputBytes
				);
				return this.#finish({ status: 'completed', ...out });
			}
			case 'error':
				return this.#fail('runtime_error', formatRuntimeError(frame, this.#job.code));
			default:
				return this.#fail('runtime_error', 'Sandbox protocol error.');
		}
	}

	/** Answer from the app for a pending call */
	toolResult(seq: number, response: ToolCallResponse) {
		const id = this.#pending.get(seq);
		if (id === undefined || this.#finished) return;
		this.#pending.delete(seq);
		const frame: SupervisorToChild =
			response.kind === 'result'
				? response.text
					? { t: 'ret', id, ok: true, value: response.value ?? null, text: true }
					: { t: 'ret', id, ok: true, value: response.value ?? null }
				: { t: 'ret', id, ok: false, code: response.code, message: response.message };
		this.#stdin?.write(encoder.encode(JSON.stringify(frame) + '\n')).catch(() => {});
	}

	/** The call at `seq` needs approval: stop now, the script is re-run on resume */
	pause(seq: number) {
		this.#finish({ status: 'paused', atSeq: seq, logs: this.#logsText() });
	}

	cancel() {
		this.#fail('cancelled', 'The execution was cancelled.');
	}
}
