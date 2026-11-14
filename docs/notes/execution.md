# Execution vertical: decisions and notes

Modules: `src/lib/server/{permissions,bridge,executions}`, remote functions
`src/lib/functions/{permissions,executions}.remote.ts`, pages `/w/[workspace]/permissions`, `/approve`,
`/approve/[id]`.

## Structure

- Each module has a factory (`createPermissionsService`, `createBridge`, `createExecutionsService`) that
  takes its dependencies (db, connectors, crypto, audit, limits, runner, workspaces, clock) and an
  `index.ts` that wires the real ones. Tests use the factories with a throwaway libSQL file database and
  fakes; nothing in the factories imports `$app/env`.
- `executions/testing.ts` (test support only): builds the test database from the **current Drizzle
  schema** via `drizzle-kit/api` (migrations lag behind while agents work in parallel) plus the custom
  `0001` SQL; `fakeCrypto` binds ciphertexts to the workspace id like the real AAD; seed helpers.
- Inside the vertical, `executions/service.ts` imports `bridge/content.ts` and `permissions/resolve.ts`
  directly (same owner; avoids pulling env-bound `index.ts` files into tests).
- Permissions and executions read `tool`, `tool_version`, `connector`, `workspace_policy`, `member`,
  `organization` directly from the shared schema (read-only); the contracts had no batch lookup for
  this and `workspaces.getPolicy` is still a stub.

## Permissions

- Default table: `readOnlyHint === true` (and not `destructiveHint`) → `allow`, anything else
  (write, destructive, missing/empty annotations, non-boolean hints) → `ask`. Free-URL tools get the
  same *proposed* level but are "to confirm" (≥ `ask`) until a row confirms them.
- Effective level = most restrictive of: chosen level (user row, else admin workspace row, else
  default), `workspace_policy.permission_floor`, the admin workspace row, and `ask` when "to confirm".
  The admin row is both the per-tool floor and the default for members without their own row.
- "To confirm": the row that provided the chosen level has a `confirmedSignatureHash` different from the
  current `tool_version.signature_hash` (or null), or no row on a free-URL tool. A stale `block` stays
  `block`.
- Unknown, removed, foreign-workspace and other users' "only for me" tools resolve to `block`.
- `setLevel`: actor must be a member; workspace rows (`userId: null`) need admin/owner; users only set
  their own row; a user row looser than the floor (policy + admin row), or an admin row looser than the
  policy floor, is refused with `POLICY_DENIED`. Every set stores the current signature hash (this is
  how "confirm" works) and records `permission.changed` (ids, scope, old/new level).
- Contract additions (additive): `PermissionRowInput`, `ResolveLevelInput`, `ToolPermission`,
  `visibleToolIds()` (discovery: non-blocked tools) and `listToolPermissions()` (permissions page).
  `index.ts` also exports the pure `defaultLevel`, `isReadOnly`, `resolveEffectiveLevel`.

## Bridge (`handleToolCall`)

Order actually implemented (stricter than the contract's list: suspension before the cache):

1. Execution row must exist, be `running`, and match `ctx.actor` workspace **and** user.
2. Kill switch for user + workspace (`limits.assertNotSuspended`).
3. Durable replay by `seq`: a `completed`/`failed` call returns its sealed outcome (results **and**
   errors are cached, so writes that errored are not retried either). Path or arguments hash differing
   from the recorded call → `replay_mismatch`. A `pending` (claimed, never finished) **write** →
   `outcome_unknown`, never re-sent; a pending read is retried.
4. `seq > execMaxToolCalls` → `limit_tool_calls`.
5. `connectors.resolveTool(actor, path)`; null → `unknown_tool`; a tool whose `workspaceId` differs
   from the execution → `workspace_mismatch` (+ denied audit). Connector suspension check.
6. Effective level on every call: `block` → error; `ask` → approval gate; `allow` → `approvedBy:
   'policy'`.
7. Claim the call (`execution_call` status `pending`), increment `tool_call_count`, call upstream,
   seal `{ argsHash, outcome }` by seq, record `tool.called` (seq, write flag, error code; no content).
8. `unknown_tool` / `invalid_params` from upstream: the message gets the refreshed declaration from
   `connectors.describeTools` (connectors does the refresh itself on that failure).

Approval gate: an approved `tool_in_script` approval for the tool covers every call of the execution;
an approved `once` approval covers only its `seq` **and only the same arguments** (the sealed preview
keeps the SHA-256 of the canonical arguments, re-sealed without the text when decided). A rejected
approval for the seq returns `approval_rejected` (the script sees a thrown error). Otherwise a pending
approval (30 min) is created with a sealed preview of the main arguments, and the bridge answers
`{ kind: 'pause' }`.

Argument hashes are only stored inside sealed payloads (a bare hash of low-entropy arguments could be
guessed).

## Executions

- `start`: workspace membership and not suspended/scheduled for deletion, kill switches, rate limit
  `exec:user:<id>`, then the row is inserted **with the sealed state `{ code }` from the start** (a
  crash mid-run leaves a `running` row that the expiry job fails as `interrupted`), then `run`.
- `run`: concurrency slot (`acquireExecutionSlot`), `expiresAt = now + timeout + 10 s`, declarations
  for the visible non-blocked tools, `runner.run` with the bridge as `onToolCall`, an abort signal
  (timeout, `cancel`, `abortRunning`).
- Paused: status `paused`, `expiresAt` = the blocking approval's expiry; outcome
  `awaiting_approval` with the prompt (workspace, connector, tool, argument preview, approval URL
  `${ORIGIN}/approve/<id>`). Deciding extends the execution window by 30 min for the agent to resume.
- Resume (`status({ resume: true })`) only when no approval is pending; claimed atomically
  (`UPDATE … WHERE status = 'paused' RETURNING`) so concurrent resumes run the script once. Re-checks
  membership, kill switches, and the code hash of the decrypted state.
- Terminal states (`completed`/`failed`/`cancelled`, expiry = `failed` with `errorCode` `expired` or
  `interrupted`) are set once via a conditional update, then **all content is wiped**: state, cached
  results, previews; pending approvals become `expired`. Audit `execution.*` with duration and tool-call
  count; `usage_daily` counters are upserted here.
- A completed execution's result is returned once (to the call that completed it); later `status`
  calls return `completed` without a result (it was wiped).
- Output: `truncateOutput` enforces `execMaxOutputBytes` on result + logs even if the runner already
  did, keeps the result over logs, and appends an explicit notice to `logs`.
- Approvals: the execution's user decides; **admins/owners of the workspace may also decide**
  (`approvedBy: 'admin'`). There is no policy column for "admins may approve" yet; if wanted, org-ops
  adds it to `workspace_policy` and `deciderRole` checks it. Others get 404.
- Contract additions (additive): `ApprovalChoice`/`APPROVAL_CHOICES`, `ApprovalChannel`,
  `ApprovalView`, `decideApproval({ channel? })`, `answerApproval`, `getApproval`, `abortRunning`.
  `index.ts` also exports `approvalMessage`, `APPROVAL_CHOICE_LABELS`, `decisionFromChoice`.

## For the MCP agent (elicitation)

- `execute` → `executions.start(...)`. If `status === 'awaiting_approval'` and the client declared form
  elicitation: show `approvalMessage(outcome.approval)` with the three `APPROVAL_CHOICES`
  (`APPROVAL_CHOICE_LABELS`); with the answer call
  `answerApproval({ userId: ctx.userId, approvalId, choice })`, which decides with
  `channel: 'elicitation'` and resumes, returning the next outcome (which may ask again). Without
  elicitation, return the outcome: it carries `approval.approvalUrl` and the agent later calls
  `execution_status` → `status({ userId, executionId, resume: true })`.
- `userId` must come from the verified bearer token; no tool argument may name an approval decision.

## For other verticals

- **foundation**: `hooks.server.ts` should `import '#lib/server/executions/index.ts'` (side effect) so the
  `executions.expire` job (every 60 s, run on start) is registered before `startJobs()`; today it is
  registered only once something imports the module.
- **org-ops**: kill-switch activation should call `executions.abortRunning({ userId })` /
  `({ workspaceId })` / `({})` (platform). Paused executions are refused on resume by
  `assertNotSuspended`.
- **mcp / discovery**: filter search/describe results with `permissions.visibleToolIds`.

## UI (library additions)

- `PermissionSelect`: level selector with options below the floor disabled, lock + tooltip naming the
  floor, "Not set" for null, reverts on failed save.
- `ToolPath`: tool path in mono + `UnverifiedBadge`.
- `FocusFrame`: brand header frame for single-task pages outside a workspace (approval links, future
  invitations).
- Pages: `/w/[workspace]/permissions` (dense table; effective badge with "to confirm"; your level;
  workspace minimum column for admins of company workspaces; "Confirm" row action; level filter),
  `/approve` (live pending approvals), `/approve/[id]` (live request + execution status, three
  decisions). Signed-out visitors of `/approve/**` are redirected to login and back.
- Live data: `watchPendingApprovals`, `watchApproval`, `watchExecution` (`query.live`, polling the DB
  every 1.5–3 s; results never go to the UI, only statuses).
