import type { ToolCallResponse } from '#lib/server/runner/types.ts';
import type { WorkspaceActor } from '#lib/server/workspaces/types.ts';

export type { ToolCallResponse };

/**
 * Bridge contract (owner: execution). The only place that turns a script's tool call into an
 * upstream call. Extractable to its own service later: it depends only on these contracts.
 *
 * For every call, in order:
 * 1. `seq` already completed for this execution → return the cached result (decrypted), never
 *    call upstream again (writes are never repeated).
 * 2. Resolve `path` inside `ctx.actor.workspaceId` only: one execution, one workspace. Unknown
 *    path → error (after a refresh attempt by the connectors module).
 * 3. Kill switches (user / workspace / platform / connector) and limits (`maxToolCalls`).
 * 4. Effective permission level, checked on every call: `block` → error; `ask` → approval
 *    unless an approval with scope `tool_in_script` already covers this tool in this execution;
 *    when approval is needed, store it and answer `{ kind: 'pause' }`.
 * 5. Call upstream via connectors (credentials decrypted there, in memory).
 * 6. Seal and store the result by `seq`, record a `tool.called` audit event (metadata only).
 *
 * Arguments and results are content: never logged, never in audit metadata.
 */
export type BridgeContext = {
	executionId: string;
	actor: WorkspaceActor;
	clientId: string | null;
	/** (additive) The MCP connection that started the execution, for the audit */
	connectionId?: string | null;
};

export type HandleToolCall = (
	ctx: BridgeContext,
	seq: number,
	path: string,
	args: unknown
) => Promise<ToolCallResponse>;
