import type { RunnerJob, RunnerResult, ToolCallResponse } from './types.ts';

/**
 * App ⇄ supervisor frames (JSON text over one WebSocket per execution, `GET /run`,
 * `Authorization: Bearer <RUNNER_SHARED_SECRET>`). Mirror of `runner/src/protocol.ts`: keep both
 * in sync.
 */
export type AppToSupervisor =
	| { type: 'job'; job: Omit<RunnerJob, 'cachedResults'> }
	| { type: 'tool_result'; seq: number; response: Exclude<ToolCallResponse, { kind: 'pause' }> }
	| { type: 'pause'; seq: number }
	| { type: 'cancel' };

export type SupervisorToApp =
	| { type: 'tool_call'; seq: number; path: string; args: unknown }
	| { type: 'result'; result: RunnerResult };
