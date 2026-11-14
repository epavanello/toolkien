# MCP vertical — decisions and notes

## Protocol and transport

- **One handler, two eras.** `/mcp` uses the SDK v2 `createMcpHandler` (2.4.0) with
  `legacy: 'stateless'`: requests carrying the 2026-07-28 `_meta` envelope go to the modern
  per-request path; everything else (2025 `initialize` and later requests) to a stateless legacy
  fallback. The same factory builds a fresh `McpServer` per request, so both eras expose the same
  six tools and no response can leak to another request.
- `supportedProtocolVersions = ['2026-07-28', '2025-11-25']` (the contract). A client asking for
  an older 2025 version is answered 2025-11-25 and decides itself; widen the constant if a target
  client breaks (see `docs/compatibility.md`).
- POST only. GET and DELETE answer 405 `Allow: POST` for both eras (no event stream, no
  sessions). No `Mcp-Session-Id`, no in-memory MCP sessions.
- Origin validation before anything else: a present `Origin` must equal `ORIGIN` (any loopback
  origin in dev, for MCP Inspector's browser UI); requests without `Origin` (non-browser
  clients) pass.
- Client-detach pattern from devmotion (`client-detach.ts`): the SDK gets the request without the
  client's abort signal and the response stream is drained if the client hangs up, so an
  `execute` is never torn down half-way.

## Elicitation per protocol era (important)

- **2026-07-28**: elicitation via `input_required` results. Capabilities are read per request from
  `_meta["io.modelcontextprotocol/clientCapabilities"].elicitation` (bare `{}` = form). Form
  preferred, else URL mode, else the link fallback. Between rounds the server keeps an
  HMAC-sealed `requestState` (`createRequestStateCodec`, key derived from `BETTER_AUTH_SECRET`,
  bound to method + user + client, TTL 30 min) holding only ids.
- **2025-11-25 and older: always the out-of-band link**, even when the client supports
  elicitation. Reason: we serve the legacy era statelessly, so (a) a `tools/call` has no record of
  the capabilities declared at `initialize`, and (b) the client's answer to a server→client
  `elicitation/create` arrives on a new POST that cannot reach the waiting instance. The SDK's
  legacy shim is therefore disabled (`inputRequired.legacyShim: false`). Follow-up if needed: a
  sessionful legacy leg routed with `isLegacyRequest` (in-memory sessions, single instance).
- Approvals (`elicitation.ts`, reused by executions): dialog text = workspace, connector, tool,
  argument preview, expiry; choices `approve_once` / `approve_tool` / `reject` (the executions
  contract's `APPROVAL_CHOICES`). Answers go to `executions.answerApproval` (channel
  `elicitation`), which resumes. Decline = reject; cancel/dismiss = still pending → link. URL mode
  points at the execution's `approvalUrl`; on retry we resume and fall back to the link if the
  same approval is still pending. **There is no approve tool**; the model can never answer.
- Workspace switch: form elicitation (confirm boolean), else URL elicitation / link to
  `/consent?switch=<id>` (in-memory request, 10 min, bound to the user). Every outcome is audited
  as `workspace.switched` (`success`/`denied`, `metadata.channel` =
  `elicitation_form | link | consent`, `clientName`).

## OAuth (Better Auth `mcp()` options in `auth.ts`)

- Issuer `${ORIGIN}/api/auth` (Better Auth base path). Discovery routes in
  `src/routes/.well-known/**` (`well-known.ts`): PRM at `/.well-known/oauth-protected-resource/mcp`
  and root; AS metadata at `/.well-known/oauth-authorization-server/api/auth` and root (for
  2025-03-26-era clients); OpenID configuration path-inserted and root. All CORS `*`.
- PKCE: only S256 exists in the provider and it is required for every client (public always,
  DCR confidential via `clientRegistrationRequirePKCE`, CIMD cannot opt out).
- Resource indicator: the provider has no "require resource" switch. Tokens get
  `aud = ${ORIGIN}/mcp` only when `resource` is sent; `/mcp` verifies the audience
  (`requireMcpAuth`), so a token without it is rejected (covered by the e2e test).
  `enforcePerClientResources: true`, resource seeded with `resourceSeedMode: 'overwrite'`.
- Access token 15 min (also per-resource TTL), refresh 30 days, rotation; reuse of a rotated
  refresh token outside the 30 s idempotent-retry window revokes the whole family (e2e test).
- `iss` in authorization responses (RFC 9207) is always on in the provider.
- Grant types `authorization_code` + `refresh_token` only (no `client_credentials`: no user).
- CIMD (`metadataProfile: 'mcp-2026-07-28'`, fetched via `net.safeFetch`) + open DCR
  (`clientRegistrationDefaultApplicationType: 'infer'` for native clients with loopback URIs).
- **`loginPage` = `/consent`**: the consent page is the single interaction entry; signed-out users
  are sent to `/login?redirectTo=/consent?<signed query>` and come back with the signed query
  intact (the foundation login only knows `redirectTo`). Limitation: `prompt=login` with a
  non-fresh session would loop (no client we know sends it).
- Consent page (`(auth)/consent`): client name (DCR names marked Unverified; CIMD clients show
  their verified domain), return origin, access list, workspace select (stored per
  (user, client) with `workspaces.setActiveWorkspace` + audit before the code is issued). The
  decision runs through remote functions and a full navigation to the returned URL (CSP
  `form-action 'self'` would block a form redirect to the client).

## `/mcp` pipeline (`endpoint.ts`)

POST → Origin → rate limit per IP (600/min) → bearer (`requireMcpAuth`, audience `/mcp`,
`azp` required) → disabled OAuth client / suspended user (`user.suspendedAt`) /
`limits.assertNotSuspended({ userId })` → rate limit per user (max(300, 5 × exec/min)) →
handler. Client name (from `oauth_client.name`, cached 60 s) goes into `McpRequestContext` for
audit. Execution rate limits and workspace kill switches stay in `executions.start`.

## Tools

- Exactly the six of the contract; descriptions teach search → describe → execute; read-only
  annotations on list/search/describe.
- `tools_search` / `tools_describe` name the workspace, hide blocked tools
  (`permissions.getEffectiveLevels`, same rule as `visibleToolIds`, plus an "asks the user for
  approval" flag), group results by connector instance (server, account hint, namespace) and tell
  the agent that one server can have several instances (one per account) and that one script can
  call several.
- `execute` description: code is the body of an async function, namespaces are globals, short
  example, type errors come back first, no imports/network.
- Errors: 4xx app errors pass their message; `NotImplementedError` → "not available yet";
  anything else is logged by class (message only in dev) and hidden.

## Contracts changed (additive)

- `connectors/types.ts`: optional `namespace` and `accountHint` on `ToolSearchHit` and
  `ToolDescription` (+ optional `connectorName` on `ToolDescription`). **Connectors: please fill
  them** (instance label / account, e.g. project or email) so the agent can tell instances apart.
- `mcp/types.ts`: `PendingWorkspaceSwitch`, `SWITCH_REQUEST_TTL_MS`.
- Suggestion for executions: `start` records audit with `clientId` only; add the client name
  (available in `McpRequestContext.clientName`) if the activity view should show it.

## UI library (additive)

- `UnverifiedBadge`: optional `tooltip` prop (default text unchanged).
- `KeyValueList`: `value` may be `string[]` (rendered as a bulleted list, `type: 'list'`).

## Tests and verification

- `pnpm vitest run src/lib/server/mcp` — 42 tests: per-tool units with fake contracts
  (`testing.ts`), the endpoint pipeline, and `e2e.spec.ts` in process (real Better Auth + test
  DB): discovery (401 challenge, PRM, AS metadata root + path-inserted), DCR and CIMD, PKCE
  (missing / wrong verifier), resource/audience (token without `resource` rejected), 15 min TTL,
  `iss`, refresh rotation + reuse detection, MCP over 2025-11-25 (initialize, tools/list,
  tools/call) and 2026-07-28 (form elicitation round for `workspace_switch`) with the SDK client.
- Against `pnpm dev` (port 5199, scratch DB): scripted discovery + DCR + PKCE + consent page +
  token worked; **MCP Inspector CLI** (`pnpm dlx @modelcontextprotocol/inspector --cli
http://localhost:5199/mcp --transport http --header "Authorization: Bearer …"`) listed the six
  tools and called `workspace_list`, `tools_search`, `execute` (runner not configured locally →
  `runner_unavailable`, as expected). Note: a dev DB made with `db:push` lacks the FTS5
  `tool_search` table; apply `drizzle/0001_search_and_audit_guards.sql`.

## README fragment

> **Connect a client**: add `https://<your-domain>/mcp` as a remote MCP server (Streamable
> HTTP). The client discovers OAuth automatically, opens the Toolkien consent page and asks which
> workspace to start in. Approvals and workspace switches appear as dialogs in clients speaking
> MCP 2026-07-28, otherwise as links to Toolkien.
