/**
 * Wire protocol of the runner supervisor.
 *
 * App ⇄ supervisor: one WebSocket per execution on `GET /run`, authenticated with
 * `Authorization: Bearer <RUNNER_SHARED_SECRET>` on the upgrade request. JSON text frames.
 *
 *   app → supervisor   { type: 'job', job }                     first frame, exactly once
 *                      { type: 'tool_result', seq, response }   answer to a `tool_call`
 *                      { type: 'pause', seq }                   approval needed at `seq`: stop
 *                      { type: 'cancel' }                       stop, report `cancelled`
 *   supervisor → app   { type: 'tool_call', seq, path, args }
 *                      { type: 'result', result }               last frame, then close
 *
 * Supervisor ⇄ sandbox (the `deno run` child): newline-delimited JSON on stdin/stdout.
 *
 *   child → supervisor { t: 'call', id, path, args }
 *                      { t: 'log', text }
 *                      { t: 'done', json, size, truncated }    `json` = JSON text of the result
 *                      { t: 'error', name, message }
 *   supervisor → child { t: 'ret', id, ok: true, value } | { t: 'ret', id, ok: false, code, message }
 *
 * Keep the app-side copy (`src/lib/server/runner/protocol.ts`) in sync.
 */

export type RunnerLimits = {
	timeoutMs: number;
	maxToolCalls: number;
	maxOutputBytes: number;
	memoryMb: number;
};

export type RunnerJob = {
	executionId: string;
	code: string;
	declarations: string;
	limits: RunnerLimits;
};

export type ToolCallResponse =
	{ kind: 'result'; value: unknown } | { kind: 'error'; code: string; message: string };

export type RunnerFailureCode =
	| 'type_error'
	| 'runtime_error'
	| 'timeout'
	| 'memory'
	| 'limit_tool_calls'
	| 'cancelled'
	| 'runner_unavailable';

export type RunnerResult =
	| { status: 'completed'; result: unknown; logs: string; truncated: boolean }
	| { status: 'failed'; code: RunnerFailureCode; message: string; logs: string }
	| { status: 'paused'; atSeq: number; logs: string };

export type AppToSupervisor =
	| { type: 'job'; job: RunnerJob }
	| { type: 'tool_result'; seq: number; response: ToolCallResponse }
	| { type: 'pause'; seq: number }
	| { type: 'cancel' };

export type SupervisorToApp =
	| { type: 'tool_call'; seq: number; path: string; args: unknown }
	| { type: 'result'; result: RunnerResult };

export type ChildToSupervisor =
	| { t: 'call'; id: number; path: string; args: unknown }
	| { t: 'log'; text: string }
	| { t: 'done'; json: string; size: number; truncated: boolean }
	| { t: 'error'; name: string; message: string };

export type SupervisorToChild =
	| { t: 'ret'; id: number; ok: true; value: unknown }
	| { t: 'ret'; id: number; ok: false; code: string; message: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const isPositiveInt = (v: unknown): v is number =>
	typeof v === 'number' && Number.isInteger(v) && v > 0;

/** Validates the first app frame; returns an error message or the job */
export function parseJob(value: unknown): RunnerJob | string {
	if (!isObject(value)) return 'Job must be an object.';
	const { executionId, code, declarations, limits } = value;
	if (typeof executionId !== 'string' || executionId.length === 0 || executionId.length > 200) {
		return 'Invalid executionId.';
	}
	if (typeof code !== 'string') return 'Invalid code.';
	if (typeof declarations !== 'string') return 'Invalid declarations.';
	if (!isObject(limits)) return 'Invalid limits.';
	const { timeoutMs, maxToolCalls, maxOutputBytes, memoryMb } = limits;
	if (![timeoutMs, maxToolCalls, maxOutputBytes, memoryMb].every(isPositiveInt)) {
		return 'Limits must be positive integers.';
	}
	return {
		executionId,
		code,
		declarations,
		limits: {
			timeoutMs: timeoutMs as number,
			maxToolCalls: maxToolCalls as number,
			maxOutputBytes: maxOutputBytes as number,
			memoryMb: memoryMb as number
		}
	};
}

/** Validates a tool response from the app (`pause` is a separate frame) */
export function parseToolResponse(value: unknown): ToolCallResponse | null {
	if (!isObject(value)) return null;
	if (value.kind === 'result') return { kind: 'result', value: value.value };
	if (
		value.kind === 'error' &&
		typeof value.code === 'string' &&
		typeof value.message === 'string'
	) {
		return { kind: 'error', code: value.code, message: value.message };
	}
	return null;
}
