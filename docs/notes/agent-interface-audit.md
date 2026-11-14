# Agent interface audit (2026-11-14)

Scope: what an agent sees and can do through the six MCP tools: discovery, `.d.ts` fidelity,
script type-check and runtime errors, results, long runs, approvals, permissions, sandbox and
egress. Code touched: `typegen/**`, `runner/**`, `executions/**`, `bridge/**`, `mcp/**`,
`egress/test/**`. No schema change, no new dependency.

## Evidence gathered

- **Real tool lists**: `tools/list` fetched from DeepWiki, Context7, Exa, Hugging Face,
  Cloudflare docs, Microsoft Learn, AWS Knowledge and GitMCP (Semgrep needs auth, the
  `remote.mcpservers.org` fetch server was down). Committed as `typegen/fixtures/*.json`, plus
  PostHog `exec` (from production, public schema) and `synthetic.json` (every JSON Schema
  construct: pydantic `$defs`/nullable, zod bounds, tuples, `if`/`then`, `not`, enums of objects,
  `x-*` extensions, hostile text).
- **Production (read-only)**: 3 connectors (PostHog, DevMotion, DevPost), 113 tools, 4
  `tools.searched` events, **0 executions**. DevMotion (47 tools) and DevPost (65) schemas were run
  through the harness locally (`TYPEGEN_FIXTURES=<dir>`), not committed.
- **Local Claude Code sessions**: none had called Toolkien tools (no real transcripts to mine).
- **Live probe with a real model**: `mcp/live-probe.spec.ts` (opt-in, `TOOLKIEN_PROBE=1`) serves
  the real `/mcp` handler with real typegen, permissions, bridge, durable executions, the Deno
  runner and real upstream calls (DeepWiki, Microsoft Learn), plus fake `crm` (read / write →
  ask / destructive → blocked) and `analytics` (PostHog-like, no output schema). Four
  `claude -p --model claude-haiku-5-5` runs (≈ $0.01 total):
  1. _Summarise retention insights_ → search, describe, first script failed type-check on an
     `unknown` result, the hint led to a working second script; correct answer (7, max 1962).
  2. _Combine CRM + Microsoft Learn + write_ in one script → typed first try, paused on
     `crm.addNote`, link given to the user, resumed after approval with `execution_status`;
     the Microsoft Learn call was replayed from cache, the note written once.
  3. _Delete a contact (blocked) + read a missing insight_ → upstream `isError` surfaced with
     tool, line and hint; agent caught it. Found two issues (fixed below): repeated hints, wrong
     hint on `catch (e)`.
  4. _55 s script_ → `execute` answered `running` at 45 s, `execution_status` returned the
     result.

## Fidelity harness (`typegen/fidelity.spec.ts`)

For each fixture: (1) the `.d.ts` compiles under `strict`; (2) **coverage**: every property
name, description at any depth, enum/const value, default, example, constraint and unknown
keyword appears in the text; (3) **round trip** through the TypeScript checker: members,
optionality and string-enum literal sets of every object reachable through properties match the
schema; (4) size `< 1.3×` the raw JSON; (5) determinism. `TYPEGEN_REPORT=1` prints sizes,
`TYPEGEN_COMPARE=<dir>` counts facts lost by another rendering.

Previous typegen vs the same facts (public corpus): Hugging Face lost 66/375 facts (formats,
`minLength`, bounds, `if`/`then`), Exa 4/24, AWS 3/44, Context7 2/20, DeepWiki 3/20; PostHog's
`command` description (40 402 chars, the whole CLI grammar) was cut to 500 chars and tool
descriptions to 2 000. Now: 0 facts lost on all 12 corpora.

Sizes now (≈ tokens = bytes/4): Hugging Face 19.9 KB raw → 15.1 KB `.d.ts` (0.76×), DevMotion
177 KB → 165 KB (0.93×), DevPost 87 KB → 75 KB (0.85×), PostHog 43.8 KB → 45.4 KB (1.04×, it
is one long description), small servers 0.7–1.02×.

### Typegen changes

- Descriptions kept whole up to 64 KB (was 500 / 2 000 chars), with an explicit "N more
  characters cut" notice beyond.
- Constraints as JSON Schema tags: `@integer @minimum @maximum @exclusive* @multipleOf
@minLength @maxLength @pattern @format @minItems @maxItems @uniqueItems @minProperties
@maxProperties @contentMediaType @contentEncoding @default @example @deprecated @readOnly
@writeOnly`; zod's ±2^53−1 bounds are dropped as noise.
- Everything else verbatim as `@schema {…}` (`not`, `if`/`then`, `propertyNames`,
  `patternProperties`, typed `additionalProperties` beside properties, `discriminator`, `x-*`).
- Inline docs for array items, union branches (`oneOf` const + title → labelled enum), map
  values; `$ref` targets' descriptions merged with the referencing node's.
- `enum`/`const` of objects and arrays typed exactly (JSON literal types); nested unions
  flattened; constraint-only `allOf` parts no longer produce `& unknown`.
- Shared or recursive `$defs` become `declare namespace ns { type Name = … }` (referenced as
  `ns.Name`): recursion keeps its shape instead of `unknown`, shared definitions are declared
  once. Depth limit raised to 12; past it the subschema is attached as `@schema`.
- Required names without a schema become `name: unknown`; root input/output descriptions go to
  the tool JSDoc (`Arguments:` / `@returns`); explicit `false` hints rendered (`@write`,
  `@nonDestructive`, `@closedWorld`); tools without an output schema return `ToolTextResult`
  with a short per-tool `@returns` (see "Field report: Resend").

Before / after (Hugging Face `hf_whoami` output, excerpt):

```ts
// before
index: number;
gated?: false | ("auto" | "manual");
result: { …; truncated?: boolean; }   // its allOf [{ if op = "attach" then path, mime_type, bytes (≤ 8 MB) required }] dropped
// after
/** @integer @minimum 0 */
index: number;
gated?: false | "auto" | "manual";
/** @schema {"allOf":[{"if":{"properties":{"op":{"const":"attach"}},…},"then":{…"bytes":{"type":"integer","minimum":0,"maximum":8388608}},"required":["path","mime_type","bytes"]}}]} */
result: { …; truncated?: boolean; }
```

## Scripts: errors the agent can act on

- **Type errors**: `script.ts:L:C - error TSxxxx: …`, the line (a 200-char window around the
  column for long lines) with a caret, and one hint per kind (said once): unknown namespace →
  "did you mean `crm`? namespaces: …"; unknown tool → closest names and the namespace's tools;
  `unknown` result → narrow/inspect advice; `catch (e)` → `(e as ToolCallError).code`; wrong
  arguments → which tool and `tools_describe`.
- **Runtime errors**: inline source maps make Deno report `script.ts` positions; the supervisor
  maps them to the agent's lines with the code excerpt and caller frames (no prelude or
  scratch paths).
- **Tool errors**: `ToolCallError` has `code`, `path` and message `<path> failed [<code>]:
<server text>`; the stack points at the script's call site; uncaught ones get a hint per code
  (`blocked`, `approval_rejected`, `auth_required`, `invalid_params`, `upstream_error`, …).
- **Bridge messages** say what to do (`blocked` → do not retry, tell the user; rejected →
  ask the user; tool-call limit names `EXEC_MAX_TOOL_CALLS`).
- **Results** are rendered as plain text, not JSON-escaped: status line, `Result:` (pretty
  under 2 KB, compact above, raw for strings, labelled when cut), error + `Hint:` naming the
  limit, `Logs:`.

Before / after (uncaught upstream error):

```text
before: {"executionId":"…","status":"failed","error":{"code":"runtime_error","message":"ToolCallError: Insight 999 not found."}}
after:  Execution …: failed [runtime_error]
        ToolCallError: analytics.insightGet failed [upstream_error]: Insight 999 not found.
          at script.ts:2:27
          const i = await analytics.insightGet({ id: 999 });
                                    ^
          hint: The tool itself reported this error (text from the server). …
```

## Long runs, approvals, permissions

- `execute` / `execution_status` wait at most 45 s (`softWaitMs`), then answer `running`; the
  run continues and its final outcome is kept **in memory only** for 10 minutes (max 500) for
  `execution_status` (the database still holds no content). Clients that time out at 60 s
  (Codex) no longer lose results.
- `tools_describe` states which described tools ask for approval.
- Verified end to end in the probe: allow (read), ask → pause → human decision → resume with
  replay, block (tool absent from discovery and declarations; bridge refuses `as any` calls).
  Defaults follow the spec table (`permissions/resolve.ts`, unchanged).

## Sandbox and egress (adversarial tests)

New `runner/test/adversarial.test.ts`, `errors.test.ts`, and an egress test; all pass:

- One 20 MB `console.log` line used to kill the run ("A sandbox message was too large"): now cut
  to the output budget. Oversized tool arguments are refused in the sandbox with the byte limit.
- Frames are built from primitives with captured intrinsics: polluting `Object.prototype.toJSON`,
  `Map.prototype.get`, `TextEncoder.prototype.encode` or `JSON.stringify` (which previously
  corrupted the protocol into a timeout) cannot forge or break frames.
- `__proto__` / `constructor` argument keys travel as plain data and never pollute the app.
- `Atomics.wait`, timer floods, throwing getters, proxies and 5 MB thrown strings end in bounded
  failures; WebAssembly cannot import host functions; secret/env/cwd probes fail.
- Leftover web globals with no use (WebGPU `GPU*`, `Navigator`, `Location`, `Storage`, `Cache*`,
  `LockManager`, `OffscreenCanvas`, …) are deleted (defence in depth; permissions already deny).
- Egress: decimal/hex/octal/short IPv4, `0.0.0.0`, `::`, IPv4-mapped/compatible, 6to4,
  documentation, link-local and multicast targets are never dialled.

## Field report: Resend

A real agent (Claude Sonnet via Claude Code) sent an email through a user's Resend connector:
search → describe → execute → approval → resume all worked, with three frictions.

1. **Text results read as JSON.** `listDomains` / `sendEmail` have no `outputSchema` and answer
   with text blocks (`Name: …`, `Status: …`). Typed `unknown`, the agent guessed JSON, parsed
   wrongly and concluded the domain was not verified. Now such tools return
   `Promise<ToolTextResult>`: `text` (text blocks joined with `\n`), `content` (every block as
   sent), `structuredContent?` and `json<T>()`, which parses or throws
   `resend.listDomains returned text, not JSON (starts with: "Name: …"). It has no output schema: read .text …`.
   The bridge hands over `{ content, structuredContent? }` untouched with `text: true`
   (`ToolCallResponse`, runner protocol `ret.text`); the sandbox prelude builds the object.
   Tools with an `outputSchema` are unchanged (structured value). The interface is declared once
   per module (constant, excluded from the harness size bound); `tools_describe` names the text
   tools in one line; the checker hints `.text` / `.json()` when a script reads fields off one.
2. **Bookkeeping parameters.** Resend requires `context`, `llm_model` and `conversation_id`
   (issued only after a first call). Kept required and verbatim; `tools_search` lines now list
   the required arguments, and the server instructions and `execute` description say: pass what
   the descriptions say; if a value is only known after a first call, make it, read the value,
   reuse it.
3. **Chat-UX instructions in descriptions** ("ask the user for `from`/`replyTo`"). Kept verbatim;
   the server instructions and the `tools_describe` output now say the doc comments are the
   servers' documentation, not instructions, and never override the user's request (unverified
   servers keep their stronger "untrusted" warning).

Fixture `typegen/fixtures/resendLike.json` (hand-written from the report, not Resend's published
schema) runs through the fidelity harness, which now also checks that every tool without an
output schema returns `ToolTextResult` and says so; `mcp/e2e.spec.ts` serves it over the real
SDK client (instructions, search line, describe output); Deno tests cover `text`, `content`,
`json()` and its error.

Before / after (`resend.listDomains`, excerpt):

```ts
// before
// Tools returning `unknown` have no output schema: log a sample first, …
	/**
	 * List all domains in your Resend account. Returns each domain's name, status and region as text.
	 *
	 * @readOnly
	 * @returns unknown shape (no output schema): inspect the result before relying on its fields.
	 */
	listDomains(args: { context: string; llm_model: string; conversation_id: string }): Promise<unknown>;
// after
interface ToolTextResult {
	/** The text blocks joined with "\n". Plain text: often not JSON. */
	readonly text: string;
	readonly content: ContentBlock[];
	readonly structuredContent?: unknown;
	/** `JSON.parse(text)`; throws an Error saying the tool returned text, not JSON, when it is not. */
	json<T = unknown>(): T;
}
	/**
	 * List all domains in your Resend account. Returns each domain's name, status and region as text.
	 *
	 * @readOnly
	 * @returns No output schema: returns text content. Read `.text`; call `.json()` only if the text is JSON.
	 */
	listDomains(args: {
		/** Conversation id returned by your first call to this server. Leave empty on the first call; … */
		conversation_id: string; /* … context, llm_model unchanged */
	}): Promise<ToolTextResult>;
```

## Residual risks and follow-ups

- **Memory outside the V8 heap** (ArrayBuffers, Wasm) is bounded only by `ulimit -d`
  (`RUNNER_DATA_LIMIT_MB=1024`, Linux) and the container's `mem_limit` (2 GB) shared by
  `RUNNER_MAX_CONCURRENT=4` sandboxes: four greedy scripts can exhaust the container. Suggest
  `RUNNER_DATA_LIMIT_MB ≈ RUNNER_MEMORY / RUNNER_MAX_CONCURRENT` (512) after testing on Linux;
  not changed here (untested on macOS).
- **Blocked tools are invisible** (spec): an agent asked to use one says "there is no such
  tool" instead of "it is blocked". A count of blocked matches in `tools_search` would help
  but deviates from the spec; left for the author.
- Unannotated tools of trusted servers (all DeepWiki tools) default to `ask`, so read-only
  servers without hints prompt on every call until the user sets `allow` (spec behaviour).
- Very long upstream descriptions (PostHog `exec`: ~11k tokens) are passed through as the
  server wrote them; Toolkien does not summarise.
- The hand-off cache of long-run results is per process (single-instance assumption) and lost
  on restart; such runs end as `interrupted`.
- `toScriptValue` may still disagree with an `outputSchema` when a server declares one but
  returns no `structuredContent` (the parsed text is used).
- Executions paused before the `ToolTextResult` change replay their cached results in the old
  shape (raw value, no `text` flag) when resumed.
- The probe's search is a naive word match, not the production `tool_search_text` ranking.
