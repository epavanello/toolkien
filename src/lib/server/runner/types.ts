/**
 * Client of the Deno runner supervisor (owner: runner).
 *
 * - The app sends one job per execution over HTTP on the internal `sandbox` network,
 *   authenticated with `RUNNER_SHARED_SECRET`. The supervisor starts a fresh `deno run` with
 *   no `--allow-*` permission, V8 memory limit, timeout and forced kill.
 * - The script is type-checked against `declarations` first; type errors return immediately.
 * - The script sees only the generated namespaces: each call is serialised (JSON-RPC over
 *   stdin/stdout to the supervisor, then back to the app on the same connection) and resolved
 *   by `onToolCall`, i.e. the bridge. No fetch, env, filesystem or remote imports.
 * - `seq` starts at 1 and increases by one per call, in call order; it is how durable
 *   executions replay cached results.
 * - The runner never sees tokens, the database or the network.
 */

export type RunnerLimits = {
	timeoutMs: number;
	maxToolCalls: number;
	maxOutputBytes: number;
	/** V8 heap limit for the Deno process */
	memoryMb: number;
};

export type RunnerJob = {
	executionId: string;
	/** TypeScript source written by the agent (content: never logged) */
	code: string;
	/** `.d.ts` of the tools the script may call (from typegen) */
	declarations: string;
	limits: RunnerLimits;
};

export type ToolCallRequest = {
	seq: number;
	/** `namespace.functionName` */
	path: string;
	args: unknown;
};

export type ToolCallResponse =
	| { kind: 'result'; value: unknown }
	/** Shown to the script as a thrown error with this message */
	| { kind: 'error'; code: string; message: string }
	/**
	 * The call needs a human approval: the runner kills the process and `run` resolves with
	 * `{ status: 'paused', atSeq }`. The script is re-run from the start on resume.
	 */
	| { kind: 'pause' };

export type RunnerFailureCode =
	| 'type_error'
	| 'runtime_error'
	| 'timeout'
	| 'memory'
	| 'limit_tool_calls'
	| 'cancelled'
	| 'runner_unavailable';

export type RunnerResult =
	| {
			status: 'completed';
			/** JSON-serialisable return value of the script */
			result: unknown;
			/** `console.*` output, in order */
			logs: string;
			/** True when result + logs were cut at `maxOutputBytes` (the agent is told) */
			truncated: boolean;
	  }
	| {
			status: 'failed';
			code: RunnerFailureCode;
			/** Message for the agent (type-check diagnostics, error message); never logged */
			message: string;
			logs: string;
	  }
	| { status: 'paused'; atSeq: number; logs: string };

export interface RunnerClient {
	run(
		job: RunnerJob,
		onToolCall: (call: ToolCallRequest) => Promise<ToolCallResponse>,
		signal?: AbortSignal
	): Promise<RunnerResult>;
	/** Supervisor reachable and authenticated */
	health(): Promise<boolean>;
}
