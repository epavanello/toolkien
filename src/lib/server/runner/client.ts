import { WebSocket } from 'undici';
import type { AppToSupervisor, SupervisorToApp } from './protocol.ts';
import type {
	RunnerClient,
	RunnerFailureCode,
	RunnerJob,
	RunnerResult,
	ToolCallRequest,
	ToolCallResponse
} from './types.ts';

export type RunnerEndpoint = {
	/** `http://runner:8787` */
	url: string;
	secret: string;
};

export type RunnerClientOptions = {
	/** Extra time on top of `limits.timeoutMs` for the type check and process start */
	graceMs?: number;
	/** How long to wait for the supervisor to confirm a cancel */
	cancelGraceMs?: number;
	healthTimeoutMs?: number;
};

const failed = (code: RunnerFailureCode, message: string): RunnerResult => ({
	status: 'failed',
	code,
	message,
	logs: ''
});

const wsUrl = (base: string) => `${base.replace(/\/+$/, '').replace(/^http/, 'ws')}/run`;

/**
 * WebSocket client of the runner supervisor. Tool calls are answered one at a time in `seq`
 * order, so a `pause` at seq N guarantees that no later call reached `onToolCall`.
 */
export function createRunnerClient(
	endpoint: RunnerEndpoint | (() => Promise<RunnerEndpoint>),
	options: RunnerClientOptions = {}
): RunnerClient {
	const resolveEndpoint = typeof endpoint === 'function' ? endpoint : async () => endpoint;
	const graceMs = options.graceMs ?? 30_000;
	const cancelGraceMs = options.cancelGraceMs ?? 2_000;

	async function run(
		job: RunnerJob,
		onToolCall: (call: ToolCallRequest) => Promise<ToolCallResponse>,
		signal?: AbortSignal
	): Promise<RunnerResult> {
		if (signal?.aborted) return failed('cancelled', 'The execution was cancelled.');
		let target: RunnerEndpoint;
		try {
			target = await resolveEndpoint();
		} catch {
			return failed('runner_unavailable', 'The script runner is not available.');
		}

		return new Promise<RunnerResult>((resolve) => {
			let settled = false;
			let paused = false;
			let calls: Promise<void> = Promise.resolve();
			let ws: WebSocket;
			try {
				ws = new WebSocket(wsUrl(target.url), {
					headers: { authorization: `Bearer ${target.secret}` }
				});
			} catch {
				resolve(failed('runner_unavailable', 'The script runner is not available.'));
				return;
			}

			const send = (frame: AppToSupervisor) => {
				if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
			};
			const finish = (result: RunnerResult) => {
				if (settled) return;
				settled = true;
				clearTimeout(guard);
				signal?.removeEventListener('abort', onAbort);
				try {
					ws.close();
				} catch {
					// already closed
				}
				resolve(result);
			};
			const guard = setTimeout(
				() =>
					finish(
						failed('timeout', `The script exceeded the ${job.limits.timeoutMs} ms time limit.`)
					),
				job.limits.timeoutMs + graceMs
			);
			const onAbort = () => {
				send({ type: 'cancel' });
				setTimeout(
					() => finish(failed('cancelled', 'The execution was cancelled.')),
					cancelGraceMs
				);
			};
			signal?.addEventListener('abort', onAbort, { once: true });

			const handleCall = async (call: ToolCallRequest) => {
				if (settled || paused) return;
				let response = job.cachedResults?.get(call.seq) as ToolCallResponse | undefined;
				if (!response) {
					try {
						response = await onToolCall(call);
					} catch {
						response = { kind: 'error', code: 'internal_error', message: 'The tool call failed.' };
					}
				}
				if (settled) return;
				if (response.kind === 'pause') {
					paused = true;
					send({ type: 'pause', seq: call.seq });
				} else {
					send({ type: 'tool_result', seq: call.seq, response });
				}
			};

			ws.onopen = () => {
				const { cachedResults: _cached, ...wire } = job;
				send({ type: 'job', job: wire });
			};
			ws.onmessage = (event) => {
				let frame: SupervisorToApp;
				try {
					frame = JSON.parse(String(event.data)) as SupervisorToApp;
				} catch {
					return finish(failed('runner_unavailable', 'Invalid message from the script runner.'));
				}
				if (frame.type === 'result') return finish(frame.result);
				if (frame.type === 'tool_call') {
					const call = { seq: frame.seq, path: frame.path, args: frame.args };
					calls = calls.then(() => handleCall(call));
				}
			};
			ws.onerror = () =>
				finish(failed('runner_unavailable', 'The script runner is not available.'));
			ws.onclose = () =>
				finish(failed('runner_unavailable', 'The connection to the script runner was lost.'));
		});
	}

	async function health(): Promise<boolean> {
		try {
			const target = await resolveEndpoint();
			const response = await fetch(`${target.url.replace(/\/+$/, '')}/health`, {
				headers: { authorization: `Bearer ${target.secret}` },
				signal: AbortSignal.timeout(options.healthTimeoutMs ?? 3_000)
			});
			if (!response.ok) return false;
			const body = (await response.json()) as { ok?: unknown };
			return body.ok === true;
		} catch {
			return false;
		}
	}

	return { run, health };
}
