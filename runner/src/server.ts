/** HTTP/WebSocket front of the supervisor: `GET /health`, `GET /run` (WebSocket). */
import { isAuthorized } from './auth.ts';
import type { SupervisorConfig } from './config.ts';
import { JobRun } from './job.ts';
import {
	parseJob,
	parseToolResponse,
	type RunnerResult,
	type SupervisorToApp
} from './protocol.ts';

const JOB_FRAME_TIMEOUT_MS = 10_000;

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
	});

/** Metadata only: never code, arguments, results or logs */
const log = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

export function createHandler(config: SupervisorConfig) {
	let active = 0;

	function serveRun(socket: WebSocket) {
		let job: JobRun | null = null;
		let closed = false;
		const send = (frame: SupervisorToApp) => {
			if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame));
		};
		const end = (result: RunnerResult) => {
			send({ type: 'result', result });
			if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'done');
		};
		const fail = (message: string) =>
			end({ status: 'failed', code: 'runner_unavailable', message, logs: '' });

		const jobTimer = setTimeout(() => {
			if (!job) fail('No job received.');
		}, JOB_FRAME_TIMEOUT_MS);

		socket.onmessage = (event) => {
			if (typeof event.data !== 'string') return fail('Binary frames are not supported.');
			let frame: Record<string, unknown>;
			try {
				frame = JSON.parse(event.data);
			} catch {
				return fail('Invalid frame.');
			}
			if (!job) {
				if (frame.type !== 'job') return fail('The first frame must be the job.');
				clearTimeout(jobTimer);
				const parsed = parseJob(frame.job);
				if (typeof parsed === 'string') return fail(parsed);
				if (active >= config.maxConcurrent) return fail('The runner is at capacity.');
				active += 1;
				const started = Date.now();
				job = new JobRun(parsed, config, {
					toolCall: (call) => send({ type: 'tool_call', ...call })
				});
				job.start().then((result) => {
					active -= 1;
					log({
						event: 'job.finished',
						executionId: parsed.executionId,
						status: result.status,
						code: result.status === 'failed' ? result.code : undefined,
						durationMs: Date.now() - started
					});
					if (!closed) end(result);
				});
				return;
			}
			if (frame.type === 'tool_result' && Number.isInteger(frame.seq)) {
				const response = parseToolResponse(frame.response);
				if (response) job.toolResult(frame.seq as number, response);
				return;
			}
			if (frame.type === 'pause' && Number.isInteger(frame.seq)) {
				return job.pause(frame.seq as number);
			}
			if (frame.type === 'cancel') return job.cancel();
		};
		socket.onclose = () => {
			closed = true;
			clearTimeout(jobTimer);
			job?.cancel();
		};
		socket.onerror = () => {};
	}

	return async (request: Request): Promise<Response> => {
		const url = new URL(request.url);
		if (!(await isAuthorized(request, config.secret))) return json({ error: 'unauthorized' }, 401);
		if (request.method === 'GET' && url.pathname === '/health') {
			return json({ ok: true, active, maxConcurrent: config.maxConcurrent });
		}
		if (request.method === 'GET' && url.pathname === '/run') {
			if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
				return json({ error: 'websocket required' }, 426);
			}
			const { socket, response } = Deno.upgradeWebSocket(request, { idleTimeout: 0 });
			serveRun(socket);
			return response;
		}
		return json({ error: 'not found' }, 404);
	};
}
