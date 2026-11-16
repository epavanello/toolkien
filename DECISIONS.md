# Decisions

Choices made where the spec (`docs/spec.md`) is open or ambiguous, and the reasons. Grouped by
area; the build notes of each vertical they come from are in the git history (`docs/notes/`,
removed after this merge).

## Product and licence

- **Open source under AGPL-3.0** (`LICENSE`, `package.json` `AGPL-3.0-only`) plus a managed
  service. Self-hosting is first-class: one compose file for plain Docker and Coolify.
- **Curated directory is community-contributed**: one JSON file per server in `directory/servers/`,
  schema-validated (`pnpm directory:validate`, also a Vitest gate). 17 seed entries, all
  `community`; Atlassian, Asana and Intercom `unverified`. Entries were not live-tested.
- Content pages (docs, legal, future blog) are markdown rendered by one mdsvex layout. Legal texts
  are drafts with a review disclaimer (tested) and bracketed placeholders.

## Platform

- **Turso (libSQL)**, not Postgres; local dev uses a `file:` database through the same driver.
- **Migrations are the only schema path** (dev, prod and tests): `pnpm db:generate` +
  `pnpm db:migrate`; no `db:push`. Custom SQL (append-only audit trigger) is migration `0001`. A
  spec fails when the schema drifts from the migrations.
- **Tool search without FTS5** (the spec asks for SQLite FTS5 in v1): production is Turso Cloud on
  the `tursodb` engine in MVCC mode, which rejects virtual tables ("Virtual tables are not
  supported in MVCC mode"), so `CREATE VIRTUAL TABLE … USING fts5` cannot run there. Instead the
  plain table `tool_search_text` holds one lowercased text per live tool (name split
  camelCase/snake_case, path, namespace, connector name, instance label, title, first description
  line, directory tags), rebuilt on sync and rename. Any query word matches (`LIKE '%word%'`,
  wildcards escaped; a few stopwords dropped; a plural `s` dropped), so a long natural-language
  query never returns nothing because one word is absent (requiring every word did: agents
  concluded tools did not exist). Ranked in TypeScript, bm25-like: query words starting a word of
  the tool name count 2, of the search text 1; ties by exact name, name prefix, name words,
  instance (namespace/name/label), description, then path. Same behaviour on local SQLite and
  Turso; no real stemming or bm25, fine at the scale of one workspace's tools. The FTS5 table
  was removed from migration `0001` (renamed `0001_audit_guards`) since production had never
  been migrated; runtime code also avoids SQLite-only pragmas.
- **Single instance**: rate limits, concurrency slots, caches, `list_changed` watchers and jobs
  live in memory; anything that must survive a restart (paused executions, approvals) is in the DB.
- **Jobs** are registered in one place (`jobs/builtin.ts`, dynamic imports, no import-time side
  effects); re-registering replaces (dev HMR).
- SvelteKit 3 native **`query.live`** for live data (execution status, approvals, activity).
- `@libsql/client`, `drizzle-orm` and `shiki` are runtime `dependencies` so adapter-node keeps them
  external (the libSQL native binding must resolve from `node_modules`).

## Identity, sign-in and workspaces

- **Passwordless**: sign-in (and sign-up) by email, or a passkey. One email (Resend) carries a
  6-digit code and a magic link. The code is typed in the same tab, so an MCP OAuth/consent
  redirect survives; the link opens `/login/confirm`, whose button consumes the token (corporate
  link scanners prefetch GET links). Tokens and codes are stored hashed, valid 10 minutes, single
  use (5 code attempts). Better Auth's HTTP endpoints for these flows are disabled; our remote
  functions call them server-side and rate-limit sends (5 per address, 20 per IP, 15 minutes).
- **Google sign-in, optional** (`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, both or neither:
  half a pair refuses to start). "Continue with Google" on sign-in and sign-up, hidden when not
  configured; it also signs up (personal workspace through the same user hook). Scopes `openid
email profile`, `prompt=select_account`; the callback lands on `redirectTo` (so the MCP consent
  flow survives the round trip), a failure comes back to the same page with `?error=`. A Google
  account whose email matches an existing user links to it (Better Auth implicit linking, only
  for emails Google marks verified). Google's tokens are never used and stored encrypted
  (`account.encryptOAuthTokens`). Exception to "every outbound call through the egress proxy":
  Better Auth calls Google's token and key endpoints with the global `fetch`; they are fixed
  Google hosts, never user-supplied URLs, so there is no SSRF surface. Google is not a second
  factor: admins of company workspaces still need a passkey.
- **No passwords and no TOTP.** TOTP would not gate an email sign-in, so the second factor
  required of **owners and admins of company workspaces is a registered passkey**, checked on role
  grants and before every admin action (an admin without one keeps the role, loses the powers).
  Follow-up worth considering: require a passkey _session_ (step-up) for admin actions.
- **Email transport** (`#lib/server/email`): Resend over plain `fetch` through `net.safeFetch`
  (egress proxy). Development without a key prints link and code to the console; production
  refuses email sign-in without `RESEND_API_KEY` + `EMAIL_FROM`. Bodies and tokens are never logged.
- **Workspace = Better Auth organization** with `kind`, `deleteScheduledAt` (7-day grace, purge
  job), `suspendedAt` (kill switch). Personal workspace on first sign-in, slug `personal-<user id>`.
- **Invite links** (32 random bytes, SHA-256 stored, optional email restriction, max uses, 1–30
  days); restricted invites are also emailed when a transport exists. Owner only moves through
  transfer; members see the member list, admins also see passkey status.
- **Policy** (`checkConnectorPolicy`, single source): members add connectors only for themselves
  and only if allowed; `allowFreeUrls` and `allowedServers` apply to everyone (admins change the
  policy for an exception).
- **Which client made a request** (Activity, CSV): every audit event of an MCP request now
  carries the client, not only `execution.started` and searches (tool calls, approvals, pauses
  and ends had only the opaque OAuth client id, so their rows and CSV lines named no client).
  Two sources, both self-asserted and display only: the OAuth registration `client_name`
  (optional in DCR, so sometimes missing, and shared by every app behind one OAuth client) and
  the MCP `clientInfo` (`name version`, e.g. `claude-code 2.1.3`): from the 2026-07-28 request
  envelope, else from the 2025-era `initialize`, remembered per user and client
  (`mcp_client_info`) since those clients are served statelessly and send it once. Executions
  copy both onto their events (`execution.client_name` / `client_info`); events recorded
  before fall back to the registered name by joining the OAuth client. Shown as
  `via Claude Code (claude-code 2.1.3)` on executions and standalone events, `client` and
  `client_info` CSV columns.
- **Audit** is append-only (trigger); metadata never holds user ids (anonymisation only nulls
  `user_id`); members see their own events, admins with a passkey everyone's. Retention 90 days
  (job). Technical logs are separate: stdout, ids only, **14 days** (journald on the host; compose
  rotates by size).
- **Kill switches** (user, workspace, platform) revoke sessions/tokens, suspend connectors, abort
  and cancel executions; workspace admins can release only switches pulled by workspace admins.

## OAuth for MCP clients

- Better Auth `mcp()` + `jwt()` + `cimd()`: issuer `${ORIGIN}/api/auth`, CIMD preferred, open DCR
  (deprecated in 2026-07-28 but widely used), PKCE S256 always, `aud = ${ORIGIN}/mcp` verified on
  `/mcp` (tokens without `resource` are useless), 15-minute access tokens, 30-day rotating refresh
  tokens with reuse detection, `iss` in responses. Grant types: authorization code + refresh only.
- **`/consent` is the single interaction entry** (also the login page for the provider): it sends
  signed-out users to `/login?redirectTo=…` and back, then asks which workspace to start in.
- **CSRF**: SvelteKit's origin check is replaced by `isCrossSiteFormRequest` in hooks so the token,
  register, revoke and introspect endpoints accept form posts from non-browser clients.

## MCP server

- One `/mcp` handler for **2026-07-28 and 2025-11-25**, stateless (no `Mcp-Session-Id`, POST only),
  fresh server per request. Pipeline: Origin → per-IP limit → bearer + audience → disabled client
  / suspended user / kill switch → per-user limit → handler (client name, MCP client info and IP in
  the context).
- **Approvals**: 2026-07-28 clients get form elicitation (else URL mode, else a link); 2025 clients
  always get the out-of-band link (stateless legacy cannot carry an elicitation answer). There is
  no approve tool: the model can never answer.
- **Recovering a lost approval dialog**: some clients never show the form (Claude Code in a cloud
  session viewed from the iOS app gives up after ~4 minutes; the model only sees a timeout) while
  the execution stays paused and its link valid. The server cannot tell such clients apart, so
  the dialog stays and `execution_status` without an `executionId` lists the executions waiting
  for approval, with links, tool, a one-line arguments preview and expiry. Scoped to the user,
  the active workspace and the calling OAuth client (the same key as the active workspace), so a
  model never sees another client's scripts; the human sees all of them on the workspace's
  Approvals page, whose link the listing gives. Plain text, never an elicitation: nothing in it
  can decide an approval.
- Six tools; descriptions teach search → describe → execute. `tools_describe` returns one
  declaration per namespace.

## Connectors

- **Custom JSON Schema → TypeScript emitter** (inline types, deterministic, every upstream string
  escaped, `@` tags neutralised, unsupported constructs degrade to `unknown`). `signatureHash` over
  schemas + annotation hints; a change makes confirmed permissions "to confirm".
- **Multiple instances per server** (one per account/project), each with label, namespace,
  credentials and tool versions; rename rewrites tool paths, ids (and permissions) survive.
- **Upstream MCP client**: SDK v2 with version negotiation, `net.safeFetch`, bearer only to the
  connector's own origin. **Upstream OAuth**: RFC 9728 → 8414, CIMD when possible else DCR, PKCE,
  RFC 8707 resource, refresh ahead and on 401, RFC 7009 revocation on disconnect/remove and when a
  member leaves (`revokeUserCredentials`). No pre-registered clients (GitHub → pasted token);
  custom auth headers unsupported.
- **Refresh triggers**: `list_changed` watcher, 6 h staleness on session open, unknown tool /
  invalid params on call, manual refresh.
- Script values come from `toScriptValue` (structured content, else parsed text), matching the
  generated `.d.ts`.
- **Development only**: plain `http://` to loopback is allowed (local MCP servers); production
  accepts https on port 443 to public addresses only.

## Execution, permissions, bridge

- **Default levels**: `readOnlyHint` (and not destructive) → allow, anything else → ask. Free-URL
  and unverified tools are "to confirm" (≥ ask) until a person confirms. Effective level = most
  restrictive of user row, admin workspace row, policy floor and "to confirm".
- **Bulk level changes** (`setToolLevels`, "Set all" on the Permissions page and in the
  connector panel): one level for many tools of one scope (the viewer's own, or the workspace
  minimum for admins), or `current` to confirm the level each tool has now. The server is
  strict and all or nothing: the same guard and checks as `setToolLevel` run for every tool in
  one transaction (reads included), and one refused tool (not visible, or a minimum stricter
  than its target) refuses the batch, naming the tools; nothing is written. Tools a minimum
  legitimately keeps from a level are not an error the user should meet, so the UI plans first
  (`bulkPlan`, with the same `satisfiesFloor` the server uses, from `#lib/core`): it leaves
  them out and names them in the confirmation ("1 tool keeps its level, the workspace minimum
  is stricter"), and sends only the rest. A server refusal then only means the data changed
  since the page loaded. Skipping on the server instead was rejected: the confirmed count could
  silently differ from what was applied. "Confirm" in bulk uses `current`, resolved on the
  server, so a stale page cannot confirm a level the tool no longer has; a tool whose current
  level is below a newer minimum cannot be confirmed (as with the single Confirm) and is named.
  Every tool gets its own `permission.changed` event (metadata `bulk` = count), recorded after
  the commit. Always confirmed in a dialog with the count, whatever the size; allowing
  destructive tools is spelled out and the button turns destructive.
- **Bridge order**: execution ownership → kill switches → durable replay by `seq` (results and
  errors cached; a pending write is never re-sent) → tool-call limit → resolve tool → effective
  level (block / approval gate / allow) → claim → upstream → seal outcome → audit (no content).
- Approvals: `once` covers its seq and the same arguments only; `tool_in_script` covers the
  execution. Admins/owners may decide members' approvals (audited as admin). 30-minute expiry.
- **Durable executions**: sealed state `{ code }` from the start; resume re-runs the script and
  replays cached calls; claimed atomically; code hash checked. Terminal states wipe all content.
- Rate limits per user, workspace and IP; concurrency slots (per user + global, FIFO); usage
  counters per workspace and UTC day.

## Runner (Deno)

- One WebSocket per execution (`/run`, shared secret, constant-time compare); tool calls answered
  one at a time in seq order, so a pause at seq N means nothing after N reached the bridge.
- **Type check in a sandboxed TypeScript compiler**, not `deno check` (which could read host files
  into diagnostics); the wrapper must not be escaped; no imports of any kind.
- Fresh `deno run` per execution with no permissions, cleared env, V8 heap limit, `ulimit -d`
  (Linux), wall-clock timeout; read-only container, `cap_drop: ALL`, internal network only.
  gVisor recommended. Development starts a local supervisor with the `deno` binary.

## Data protection and crypto

- **Envelope encryption**: one DEK per workspace and version (generated in the app), wrapped by
  OpenBao transit; values AES-256-GCM with the workspace id as AAD. Every sealed column is listed
  in `SEALED_GROUPS` (a spec checks coverage) so key rotation re-seals them. Dev fallback
  `TOOLKIEN_DEV_MASTER_KEY`, refused in production. Self-hosters may use `TOOLKIEN_MASTER_KEY`
  instead of OpenBao (`static:` prefix, distinct HKDF label; refused together with OpenBao
  credentials): weaker, documented as such; the managed service uses OpenBao.
- **SSRF**: IPv4 blocklist, IPv6 allowlist, local names rejected before DNS, port 443 only, DNS
  pinned at connect, redirects re-checked; production egress through the CONNECT-only proxy.
- Content (tokens, arguments, results, code) is stored only sealed and wiped when no longer needed.
- **OpenBao 2.7**: raft, Shamir 5/3, root token revoked after init, AppRoles for app and backup.
  Its own compose stack (`deploy/openbao/compose.yml`), joined by the app over the internal
  `toolkien_vault` network: app deploys recreate every container of their stack, and OpenBao
  must not be resealed on every push.
- **Compose**: `core` and `sandbox` networks are internal; Coolify needs Raw Compose Deployment.

## UI

- **Pages compose, the library presents** (`#lib/components/app`). Additions during the build:
  Timeline, Callout, RevealDialog, PermissionSelect, ToolPath, FocusFrame, ToolDefinition,
  EmailSignIn, DataTable groups, marketing and SEO components.
- Dense neutral style, one blue accent, light/dark via mode-watcher (pre-paint script in
  `app.html` for the CSP nonce). Side panels sit below dialogs; KeyValueList pairs by container
  width.
- **Syntax highlighting with Shiki, server side only** (`#lib/server/highlight.ts`): `shiki/core`
  with the JavaScript regex engine, ts/js/json/bash, dual themes as CSS variables following
  `.dark`. `CodeBlock` gets HTML through a batched remote query (no Shiki in the client bundle);
  mdsvex code fences use the same module; ` ```ts twoslash ` fences get CSS-only type hovers at
  build time.
- **Pending approvals per workspace**: its own page in the workspace navigation
  (`/w/<slug>/approvals`, "Approvals"), not a block on Activity, so it has a stable URL the MCP
  listing can point to and an empty state of its own. It lists the viewer's own paused requests
  in that workspace (same scope as `/approve`: admins decide members' requests through the link
  they get), live, with tool, connector, a one-line arguments preview (the viewer's own
  content, as on the approval page), client, requested and expiry; "Review" opens the existing
  `/approve/<id>` page, which stays the only place that decides.
- **Sticky tool headers**: on the Permissions page the connector summary sticks to the top of
  the page while its section scrolls and the operation-type group header sticks right below it
  (its offset is the summary's measured height, `--sticky-top`, since the summary wraps on
  phones); in the connector panel the group headers stick to the panel's scroller, whose
  padding moved inside so nothing scrolls above them. The workspace top bar is not sticky, so
  the page offset is 0. Opaque backgrounds, z-index above row content (code block copy
  buttons), and `overflow-clip` instead of `overflow-hidden` on the cards so they are not
  scroll containers.
- No OG image yet (would need satori/resvg).
