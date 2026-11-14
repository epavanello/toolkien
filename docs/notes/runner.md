# Runner — decisions and notes

Owner: runner vertical. Code: `runner/` (Deno supervisor + sandbox) and `src/lib/server/runner/` (app-side client).

## App ↔ supervisor protocol

- **One WebSocket per execution** on `GET /run` (`ws://runner:8787/run`). The shared secret goes in `Authorization: Bearer <RUNNER_SHARED_SECRET>` on the upgrade request and is compared in constant time (SHA-256 of both values, XOR over 32 bytes). Unauthenticated requests get `401` before any upgrade. `GET /health` (same auth) returns `{ ok, active, maxConcurrent }`.
- Why WebSocket: the spec wants tool calls to come back to the app "on the same connection". A WebSocket is an HTTP upgrade on the internal network and gives a full-duplex channel without inventing a long-poll or a second endpoint. The client uses undici's `WebSocket` (already a dependency) because it can send the auth header.
- Frames (JSON text; types in `runner/src/protocol.ts`, mirrored in `src/lib/server/runner/protocol.ts`):
  - app → runner: `job` (first, once), `tool_result { seq, response }`, `pause { seq }`, `cancel`.
  - runner → app: `tool_call { seq, path, args }`, `result { result }` (last frame, then close).
- Supervisor ↔ sandbox: newline-delimited JSON on stdin/stdout (`call`/`log`/`done`/`error` up, `ret` down). The supervisor assigns `seq` (1, 2, … in receipt order), validates every frame (`namespace.function` path, message size cap) and never trusts the sandbox's own numbering.
- **Tool calls are answered one at a time, in seq order**, by the client (a `Promise.all` in the script is serialised). So when `onToolCall` answers `{ kind: 'pause' }` at seq N, no call after N has reached the bridge; the client sends `pause`, the supervisor kills the process and returns `{ status: 'paused', atSeq: N, logs }`.
- Durable resume: the script is re-run from the start and gets the same seqs. Cached results can be answered either by the bridge (its contract) or by the client through the new optional `RunnerJob.cachedResults: Map<seq, response>` (never sent to the runner).

## Script format (for the mcp `execute` description)

- The code is the **body of an async function**: top-level `await`, `return <value>` gives the result (JSON-serialisable; `undefined` → `null`). No `import`/`export`, no `import()`, no `import.meta`, no `eval`/`new Function`.
- Globals: the tool namespaces from typegen (`await gmail.searchThreads({ … })`), `console.*` (captured), `ToolCallError` (thrown on `{ kind: 'error' }`, with `.code`), timers, `structuredClone`, `TextEncoder`/`TextDecoder`, `URL`/`URLSearchParams`, `atob`/`btoa`, plus ES2023. No `fetch`, `Deno`, `process`, `Worker`.
- Declarations are expected as a global script (`declare const ns: { … }` or `declare namespace ns`); top-level `export`/`import` in the `.d.ts` are blanked so a module-style file works too. The namespace names are read from the declarations.
- Type errors come back immediately as `failed/type_error`, formatted `script.ts:LINE:COL - error TSxxxx: message` (lines relative to the agent's code) with the offending line and a caret, max 30.

## Type checking: sandboxed TypeScript, not `deno check`

`deno check` runs with full read access: a `/// <reference path="/proc/1/environ">` or a JSON import of any file would put its content in the diagnostics. The checker (`runner/src/checker.ts`) is the TypeScript compiler (`npm:typescript@6.0.3`, pinned with integrity in `runner/deno.lock`, cached at build) running in its own `deno run` with only `--allow-read` on the TypeScript package, an in-memory compiler host (script + tools + globals), `noResolve`, cleared env, 512 MB heap and a 20 s timeout. It also:

- verifies the wrapper was not escaped (exactly one top-level function ending at our closing brace), so the agent cannot add static imports — Deno loads static imports of local files **without** permission checks, so this is the guard that matters;
- rejects `import()`, `import.meta` and `import('…')` types anywhere;
- transpiles to JS, so the sandbox loads plain `.js` and never needs an emit cache.

A check takes ~60-150 ms (V8 code cache of typescript.js kept in `/tmp/checker-deno-dir`, whose `npm/` links to the read-only cache).

## Sandbox process

- Fresh `deno run` per execution in a per-job `0700` scratch dir (deleted afterwards), env cleared, with **no `--allow-*`** plus explicit `--deny-read/net/env/write/run/sys/ffi/import`, `--no-remote --no-npm --no-config --no-lock --cached-only --no-code-cache`, `--v8-flags=--max-old-space-size=<memoryMb>,--disallow-code-generation-from-strings`.
- `prelude.js` takes stdin/stdout and `Deno.inspect`, then deletes `Deno`, `Worker`, `process`, `fetch`, `WebSocket`, … and defines each namespace as a non-writable Proxy. It is hardening; the boundary is the permission set + the checker + supervisor validation.
- Linux: `RUNNER_DATA_LIMIT_MB` wraps the process in `ulimit -d` (RLIMIT_DATA), which caps ArrayBuffer memory outside the V8 heap (verified in Docker: a 4 GB allocation fails with `RangeError`). Not applied on macOS dev.
- Limits from the app are clamped by supervisor caps. The wall-clock timeout starts when the sandbox starts (type check has its own timeout), then `SIGKILL`. `maxToolCalls` is enforced by the supervisor.
- Output: result first, then logs, both within `maxOutputBytes`; when cut, `truncated: true` and explicit notices (`… [logs truncated: output limit is N bytes]`, a truncated result becomes a string ending with `… [result truncated: X bytes, output limit is N bytes]`).
- Failures: `type_error`, `runtime_error` (uncaught error / unhandled rejection / non-serialisable result / protocol violation), `timeout`, `memory` (V8 OOM), `limit_tool_calls`, `cancelled` (abort signal or socket closed), `runner_unavailable` (not reachable, bad auth, at capacity, invalid job).
- Supervisor logs metadata only: `{ event: 'job.finished', executionId, status, code, durationMs }`.

## Container (`runner/Dockerfile`, build context `./runner`)

`denoland/deno:alpine-2.9.8` (~180 MB; busybox `sh` is needed for `ulimit -d`), non-root `deno` user, deps cached at build with `--frozen`, runtime `--cached-only`. Works with a read-only rootfs: only `/tmp` is written (scratch dirs + checker code cache). Verified with `--read-only --tmpfs /tmp:size=256m --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 1g`.

Compose (infra): service `runner`, network `sandbox` only (`internal: true`), port 8787 not published, `read_only: true`, `tmpfs: ["/tmp:size=256m,mode=1777"]`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `pids_limit`, `mem_limit` ≥ `RUNNER_MAX_CONCURRENT × (memoryMb + 512 checker)` + ~100 MB, cpu limit; `runtime: runsc` if gVisor is available. Env: `RUNNER_SHARED_SECRET` (same value as the app's, ≥ 32 chars). No volume, never the Docker socket. No HTTP healthcheck tool in the image; the app's `runner.health()` covers it.

Supervisor env (all optional except the secret): `RUNNER_SHARED_SECRET`, `RUNNER_HOST` (0.0.0.0), `RUNNER_PORT` (8787), `RUNNER_MAX_CONCURRENT` (4), `RUNNER_SCRATCH_DIR` (/tmp), caps `RUNNER_MAX_TIMEOUT_MS` (300000), `RUNNER_MAX_MEMORY_MB` (512), `RUNNER_MAX_OUTPUT_BYTES` (1 MiB), `RUNNER_MAX_TOOL_CALLS` (1000), `RUNNER_MAX_CODE_BYTES` (256 KiB), `RUNNER_MAX_DECLARATIONS_BYTES` (4 MiB), `RUNNER_MAX_MESSAGE_BYTES` (8 MiB), `RUNNER_CHECK_TIMEOUT_MS` (20000), `RUNNER_CHECK_MEMORY_MB` (512), `RUNNER_DATA_LIMIT_MB` (1024 in the image, off by default).

## App side

- `#lib/server/runner/index.ts` exports `runner` (`RunnerClient`) and `createRunnerClient`. With `RUNNER_URL` + `RUNNER_SHARED_SECRET` it talks to the container; in `dev` without them it starts a local supervisor once (`local.ts`: `deno` from PATH, 127.0.0.1, random port and secret, survives HMR); in production without them every run returns `runner_unavailable`.
- The client adds a guard timer (`timeoutMs + 30 s`), forwards `AbortSignal` as `cancel`, and turns a throwing `onToolCall` into a `ToolCallError('internal_error')` for the script.

## Residual risks / follow-ups

- Supervisor and sandboxes share a uid (no `setuid` with `cap_drop: ALL`); sandboxes have no read permission and static imports are rejected by the checker, so `/proc/1/environ` is not reachable, but gVisor is the recommended extra layer.
- CPU is bounded per job only by the timeout; set a container CPU limit.
- A pathological type can still make the checker slow: bounded by its timeout and heap.

## Commands

- `cd runner && deno task test` (29 Deno tests, incl. escape attempts); `pnpm vitest run src/lib/server/runner` (integration with a local supervisor, skipped without `deno`).
- `cd runner && deno task cache` before `deno task start` outside Docker.
- `docker build -t toolkien-runner runner/`.
