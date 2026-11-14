# Decisions

Choices made where the spec is open or ambiguous. Newest at the bottom of each section.

## Platform

- **Turso (libSQL) instead of Postgres in milestone 1.** The spec's stack table says Turso; the milestone list still mentions Postgres. Turso wins (EU region, point-in-time restore). Local dev uses a `file:` database through the same driver.
- **SvelteKit 3 native `query.live`** (async generator remote queries) instead of copying Pack's `liveQuery.svelte.ts`: it is built in and simpler. Used for execution status, pending approvals and activity.
- **Single instance.** Rate limits, concurrency, `.d.ts` caches and jobs live in memory (`#lib/server/{limits,jobs}`); everything that must survive a restart (paused executions, approvals) is in the database.
- **MCP spec 2026-07-28** (latest stable), with version negotiation down to 2025-11-25. Stateless Streamable HTTP: no `Mcp-Session-Id`, no GET stream.

## Identity and workspaces

- **Workspace = Better Auth organization.** `organization` gets `kind` (`personal` | `company`), `deleteScheduledAt` (7-day grace) and `suspendedAt` (kill switch) as additional fields. Better Auth's own organization deletion is disabled; deletion goes through the grace period.
- **Personal workspace on sign-up** via `databaseHooks.user.create.after` (idempotent; `/` re-checks). Its slug is `personal-<user id>`: stable and free of personal data.
- **No email service**: invitations are links (`workspace_invite_link`, token stored as SHA-256), there are no verification or password-reset emails. A forgotten password currently needs a passkey or an operator; to revisit before launch.
- **Login methods**: email + password (min 12 characters) and passkeys; TOTP 2FA available. **2FA or a passkey is required for owners and admins of company workspaces** (`requiresSecondFactor` in the workspaces contract; enforcement by org-ops).
- **Users are suspended** with `user.suspendedAt`; the hooks treat a suspended user as signed out.

## OAuth for MCP clients

- Better Auth `mcp()` (OAuth 2.1 provider) + `jwt()` + `cimd()`: CIMD preferred, DCR still allowed (deprecated in 2026-07-28 but widely used). PKCE required, tokens audience-bound to `${ORIGIN}/mcp`, 15-minute access tokens, 30-day refresh tokens with rotation and reuse detection (30 s replay window, the MCP plugin default).
- CIMD documents are fetched through `net.safeFetch` (SSRF rules + egress proxy).
- `/mcp` ignores cookies entirely: bearer tokens only.
- **CSRF**: SvelteKit's built-in origin check rejected form-encoded POSTs without `Origin` from non-browser MCP clients to the token endpoint before hooks run. It is disabled (`csrf.trustedOrigins: ['*']`) and reimplemented in `hooks.server.ts` (`isCrossSiteFormRequest`): every form-encoded state-changing request must carry our `Origin`, except `/api/auth/oauth2/{token,register,revoke,introspect}`, which authenticate with client credentials / PKCE, never cookies. Session cookies are also `SameSite=Lax`.

## Data and security

- **Envelope encryption columns**: every sealed value is `<x>_ciphertext`, `<x>_nonce`, `<x>_key_version` (AES-256-GCM, workspace id as associated data) with one DEK per workspace and version in `workspace_data_key`, wrapped by OpenBao transit. Dev without OpenBao uses `TOOLKIEN_DEV_MASTER_KEY`, refused in production.
- **Durable execution state** (code, approvals) and cached call results are stored sealed and wiped when the execution ends or expires; the script's SHA-256 is kept to refuse a resume with different code.
- **Approval previews** (main arguments shown on the approval page) are sealed and wiped once decided.
- **Audit log is append-only** by trigger; the only allowed update is anonymisation (user ids → NULL) on account deletion; the retention job deletes rows older than `AUDIT_RETENTION_DAYS` (90).
- **Tool search** uses an FTS5 virtual table (`tool_search`) with a `keywords` column holding the camelCase path split into words.
- **Permission rows**: `user_id IS NULL` = workspace floor set by admins, otherwise the member's own level; effective = most restrictive of default, policy floor, workspace row, user row.
- **Connector auth type `none`** added for public MCP servers that need no credentials.
- **Security headers**: CSP with nonces (`kit.csp`), `frame-ancestors 'none'`, `form-action 'self'`, HSTS in production, `X-Frame-Options: DENY`, `nosniff`, strict referrer, COOP. The light/dark pre-paint script lives in `app.html` to carry the nonce.

## UI

- **Component library first**: presentation lives in `#lib/components/app/` as variants; pages only compose (see `docs/conventions.md` → UI).
- Dense PostHog-like style: neutral palette, single blue accent (`primary`), semantic success/warning/destructive, small radii, system monospace for ids and code.
- Markdown pages (`+page.md`) via mdsvex + `rehype-slug` with one layout (`components/markdown/markdown-layout.svelte`).
