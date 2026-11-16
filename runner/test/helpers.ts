import { loadConfig, type SupervisorConfig } from '../src/config.ts';
import { JobRun } from '../src/job.ts';
import type { RunnerLimits, RunnerResult, ToolCallResponse } from '../src/protocol.ts';

export const SECRET = 'test-secret-test-secret-test-secret-0123';

let config: SupervisorConfig | null = null;
export async function testConfig(): Promise<SupervisorConfig> {
	config ??= await loadConfig((name) =>
		name === 'RUNNER_SHARED_SECRET' ? SECRET : name === 'RUNNER_PORT' ? '0' : Deno.env.get(name)
	);
	return config;
}

export const DECLARATIONS = `
declare const crm: {
	/** Find contacts */
	findContacts(args: { query: string }): Promise<{ id: string; name: string }[]>;
	/** Create a note (write) */
	addNote(args: { contactId: string; text: string }): Promise<{ ok: boolean }>;
};
`;

/**
 * A tool without an output schema, as typegen declares it (`ToolTextResult` mirrors
 * `TEXT_RESULT_DECLARATIONS` in `src/lib/server/typegen/declarations.ts`)
 */
export const TEXT_DECLARATIONS = `
interface ToolTextResult {
	readonly text: string;
	readonly content: ContentBlock[];
	readonly structuredContent?: unknown;
	json<T = unknown>(): T;
}
type ContentBlock =
	| { type: 'text'; text: string }
	| { type: 'image' | 'audio'; data: string; mimeType: string }
	| { type: 'resource_link'; uri: string; name: string; mimeType?: string; description?: string }
	| { type: 'resource'; resource: { uri: string; mimeType?: string; text?: string; blob?: string } };
declare const resend: {
	/** @returns No output schema: returns text content. Read \`.text\`; call \`.json<T>()\` only if the text is JSON. */
	listDomains(args: {}): Promise<ToolTextResult>;
	/** @returns No output schema: returns text content. Read \`.text\`; call \`.json<T>()\` only if the text is JSON. */
	getStats(args: {}): Promise<ToolTextResult>;
};
`;

export const LIMITS: RunnerLimits = {
	timeoutMs: 10_000,
	maxToolCalls: 50,
	maxOutputBytes: 100 * 1024,
	memoryMb: 128
};

export type MockTool = (args: unknown, seq: number) => ToolCallResponse | { kind: 'pause' };

export const defaultTools: Record<string, MockTool> = {
	'crm.findContacts': (args) => ({
		kind: 'result',
		value: [{ id: 'c1', name: `match:${(args as { query: string }).query}` }]
	}),
	'crm.addNote': () => ({ kind: 'result', value: { ok: true } })
};

/** Runs a job directly through `JobRun` (no WebSocket), answering tool calls with `tools` */
export async function run(
	code: string,
	options: {
		tools?: Record<string, MockTool>;
		limits?: Partial<RunnerLimits>;
		declarations?: string;
		calls?: { seq: number; path: string; args: unknown }[];
	} = {}
): Promise<RunnerResult> {
	const tools = options.tools ?? defaultTools;
	const calls = options.calls ?? [];
	const job: JobRun = new JobRun(
		{
			executionId: crypto.randomUUID(),
			code,
			declarations: options.declarations ?? DECLARATIONS,
			limits: { ...LIMITS, ...options.limits }
		},
		await testConfig(),
		{
			toolCall: (call) => {
				calls.push(call);
				const tool = tools[call.path];
				const response = tool
					? tool(call.args, call.seq)
					: ({
							kind: 'error',
							code: 'unknown_tool',
							message: `Unknown tool ${call.path}`
						} as const);
				// Answer asynchronously, like the app would
				queueMicrotask(() => {
					if (response.kind === 'pause') job.pause(call.seq);
					else job.toolResult(call.seq, response);
				});
			}
		}
	);
	return await job.start();
}
