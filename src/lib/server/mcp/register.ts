/**
 * Transport-neutral MCP tool registration (the how-much / devpost `defineTool` pattern, on the
 * v2 SDK). Knows nothing about HTTP, OAuth or SvelteKit: `server.ts` injects the per-call
 * environment, so tool files are unit-tested against a plain object.
 */
import { dev } from '$app/env';
import { isHttpError } from '@sveltejs/kit';
import type {
	CallToolResult,
	InputRequiredResult,
	ServerContext,
	ToolAnnotations
} from '@modelcontextprotocol/server';
import type { z } from 'zod';
import { NotImplementedError } from '#lib/server/not-implemented.ts';
import type { RequestStatePayload } from './elicitation.ts';
import type { McpClientCapabilities, McpRequestContext, McpToolName } from './types.ts';

/** What a tool returns: a final result, or (2026-07-28 only) a request for human input */
export type ToolResult = CallToolResult | InputRequiredResult;

export const text = (value: string): CallToolResult => ({
	content: [{ type: 'text', text: value }]
});

export const toolError = (value: string): CallToolResult => ({
	isError: true,
	content: [{ type: 'text', text: value }]
});

/** Everything a tool needs to know about the current call */
export type ToolEnv = {
	request: McpRequestContext;
	/** `modern` = 2026-07-28 (per-request envelope), `legacy` = 2025-era stateless */
	era: 'legacy' | 'modern';
	/** Declared in the request envelope; always false on the legacy era (see notes) */
	capabilities: McpClientCapabilities;
	/** Responses to our previous `input_required` round (untrusted client values) */
	inputResponses: Record<string, unknown> | undefined;
	/** The verified `requestState` of the previous round, if any */
	requestState: RequestStatePayload | undefined;
	/** Seals a payload into an HMAC-protected, user/client-bound `requestState` */
	mintState: (payload: RequestStatePayload) => Promise<string>;
};

export type ToolEnvResolver = (ctx: ServerContext) => ToolEnv;

/**
 * Minimal structural view of the SDK's `McpServer.registerTool`. Typing it here keeps tool
 * modules free of transport imports and lets tests register into a plain object.
 */
export interface McpServerLike {
	registerTool(
		name: string,
		config: {
			title?: string;
			description: string;
			inputSchema?: z.ZodType;
			annotations?: ToolAnnotations;
		},
		handler: (input: never, ctx: ServerContext) => Promise<ToolResult>
	): unknown;
}

/**
 * Turns a thrown error into a tool error the agent can act on. App errors (`error(4xx, …)`)
 * carry user-facing messages; anything else is logged (no arguments, no payload) and hidden.
 */
export function errorResult(tool: string, cause: unknown): CallToolResult {
	if (isHttpError(cause) && cause.status < 500) return toolError(cause.body.message);
	if (cause instanceof NotImplementedError) {
		return toolError('This part of Toolkien is not available yet. Try again later.');
	}
	// Production logs the error class only: messages may echo upstream content
	const detail =
		cause instanceof Error ? (dev ? `${cause.name}: ${cause.message}` : cause.name) : 'unknown';
	console.error(`[mcp] ${tool} failed: ${detail}`);
	return toolError('Internal error. Try again later.');
}

/** Registers one tool: resolves the call environment once and maps errors to tool errors */
export function defineTool<Schema extends z.ZodType>(
	server: McpServerLike,
	resolveEnv: ToolEnvResolver,
	opts: {
		name: McpToolName;
		title: string;
		description: string;
		input: Schema;
		annotations: ToolAnnotations;
		handler: (env: ToolEnv, input: z.infer<Schema>) => Promise<ToolResult>;
	}
): void {
	server.registerTool(
		opts.name,
		{
			title: opts.title,
			description: opts.description,
			inputSchema: opts.input,
			annotations: { title: opts.title, ...opts.annotations }
		},
		async (input: never, ctx: ServerContext) => {
			try {
				return await opts.handler(resolveEnv(ctx), input as z.infer<Schema>);
			} catch (cause) {
				return errorResult(opts.name, cause);
			}
		}
	);
}
