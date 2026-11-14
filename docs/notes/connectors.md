# Connectors vertical — decisions

## Typegen (`src/lib/server/typegen/`)

- **Custom emitter, not `json-schema-to-typescript`.** That library emits named global `interface`s (collisions across tools in one `.d.ts`), depends on upstream `title`s, is async/heavy and copies descriptions verbatim. Ours (`schema.ts`) emits inline anonymous types, deterministically, and escapes every upstream string. Supported subset: `type` (incl. arrays), `properties`/`required`, `items`/`prefixItems`, `enum`/`const`, `anyOf`/`oneOf`/`allOf`, local `$ref` (recursion → `unknown`), `additionalProperties`/`patternProperties`, OpenAPI `nullable`; depth 8, 200 props per object. Anything else degrades to `unknown`, never a wrong type. `json-schema-to-typescript` stays in `package.json` but is unused (integrator may drop it).
- Untrusted text: `*/` is escaped, control chars stripped, lines starting with `@` become `\@` (a server cannot fake `@readOnly`), 2000-char cap.
- Tags: `@readOnly`, `@destructive` (only when not read-only), `@idempotent`, `@openWorld`, `@unverified` + warning; no `outputSchema` → `Promise<unknown>` with an "inspect the result" `@returns`. Namespace JSDoc names the connector and, for labelled instances, the account/project.
- `signatureHash` = SHA-256 of canonical JSON (sorted keys) of input schema, output schema and the four annotation hints (titles/descriptions excluded). Tests type-check generated `.d.ts` with the real TypeScript compiler.
- Names: camelCase, `_` before a leading digit; namespaces avoid reserved words and script globals (`delete` → `deleteTools`). Function names unique per connector (sorted upstream names, numeric suffix).
- Contract additions (additive): `toNamespace`, `signatureHash`; `ToolTypeInput.connectorName/instanceLabel`.

## Curated directory (community, data-driven)

- One JSON file per server in top-level `directory/servers/<id>.json`; zod schema in `src/lib/server/connectors/directory-schema.ts` (pure, no app imports), JSON Schema exported to `directory/schema.json` (`$schema` for editors).
- `pnpm directory:validate` (plain Node type stripping, no deps) checks every entry, id = file name, unique ids/namespaces/URLs, and that `schema.json` is in sync (`--write` regenerates). `directory.spec.ts` runs the same validation in Vitest (CI gate) and checks the app bundles every file.
- The app bundles entries with `import.meta.glob` at build time and parses them at startup (invalid file → loud failure).
- `directory/README.md` + `directory/CONTRIBUTING.md` (how to propose, what reviewers check: remote https only, official endpoint, annotation accuracy, minimal scopes, honest verification). Org-ops links them from the docs site.
- Seeded with 17 entries (GitHub, Linear, Notion, Sentry, Atlassian, Asana, Stripe, Supabase, Neon, Vercel, PostHog, Intercom, Hugging Face, Cloudflare Docs, Context7, DeepWiki, Exa). Not re-tested live: all are `community` with notes, **Atlassian, Asana, Intercom are `unverified`** (endpoint paths uncertain, see their notes). Verified annotation overrides only for clearly read-only doc/search tools. Entries with `verification.status: unverified` create connectors flagged `unverified` (like free URLs).

## Multiple instances of one server

- A server (directory or URL) can be added any number of times: one instance per account/project, each with its own label, namespace, credentials/OAuth grant, client registration, tool sync and versions.
- `connector.label` (new nullable column). Namespace derived from the entry namespace + lowercased label (`posthog` + `DevMotion` → `posthogDevmotion`); an explicit namespace must be a valid camelCase identifier and is **unique across the whole workspace** (409 otherwise). Auto-derived ones get the host prefix, then a number, on collision.
- `rename(actor, id, { label, namespace, name })` (contract addition) rewrites tool paths in place (`posthog.query` → `posthogDevmotion.query`) — tool ids, hence permissions, survive — and rebuilds the search rows.
- Discovery: the FTS `keywords` column includes connector name and label words (searching "devmotion" finds that instance); `searchTools` summary is `PostHog (DevMotion): Run a HogQL query.`; hits and descriptions carry `namespace`, `connectorName`, `accountHint` (= label) as the mcp agent asked.
- UI: the connectors table groups instances by server (new `DataTable` `group` prop) and shows the label; rename dialog; the directory add form asks for a label and an optional namespace.

## Connectors module (`src/lib/server/connectors/`)

- Files: `access.ts` (visibility/roles), `credentials.ts` (sealed via `crypto`), `session.ts` (decrypt + refresh-ahead), `oauth.ts` (upstream OAuth), `upstream.ts` (MCP client), `sync.ts` (versioned definitions + FTS), `discovery.ts` (search/describe/declarations/resolve), `watch.ts` (list_changed), `service.ts`, `directory*.ts`.
- **Visibility**: shared connectors (`owner_user_id IS NULL`) + the actor's own. Manage: admins/owners, or the owner of an "only me" connector. Authenticate: `shared` → admins; `personal` → each member for their own account.
- **Policy** (`workspaces.getPolicy`): `allowedServers` (directory ids or origins) applies to everyone; `allowPersonalConnectors` and `allowFreeUrls` restrict members only (admins set the policy). Free URLs: `net.assertSafeUrl`, https only, flagged unverified; auth type auto-detected (protected resource metadata → OAuth, else none) unless given.
- **Upstream MCP client**: `@modelcontextprotocol/client` `Client` + `StreamableHTTPClientTransport` with `versionNegotiation: 'auto'` (2026-07-28 `server/discover`, falls back to the 2025 handshake; tested both), fetch = `net.safeFetch` with no redirects; the bearer token is attached **only** to the connector's own origin. One short-lived connection per operation.
- **Upstream OAuth**: RFC 9728 → RFC 8414 discovery, CIMD (`/connectors/oauth/client-metadata.json`) when the AS supports it and our origin is https, else DCR (public client, `none` auth); no pre-registered clients (clear error suggesting a token). PKCE S256 required, RFC 8707 `resource` (checked against the server URL), scopes = directory scopes → `WWW-Authenticate` challenge → PRM `scopes_supported`. Flow state in new table `upstream_oauth_flow` (SHA-256 of `state`, sealed verifier, 10 min, single use); the callback must be completed by the same signed-in user (`completeOAuth(state, code, { userId, iss })`, additive param; `iss` checked per RFC 9207 by the SDK). Refresh 60 s before expiry and once on 401; RFC 7009 revocation on disconnect/remove (best effort).
- **Callback routes**: `src/routes/connectors/oauth/callback/+server.ts` (login redirect if needed, AS error details never echoed) and `src/routes/connectors/oauth/client-metadata.json/+server.ts`.
- **Sync**: paths stay stable; a new `tool_version` whenever schema/annotations/title/description change; `signatureChanged` makes confirmed permissions "to confirm" automatically (permissions compare `confirmed_signature_hash` with the current version — nothing to call); description changes → `connector.descriptions_changed` audit + `descriptionChanged` in the result/UI warning. Directory annotation overrides win over server hints. Concurrent syncs per (connector, credential) are deduplicated. Failures set a content-free `statusMessage` (shared credentials only; personal failures are per user).
- **Refresh triggers**: (1) `list_changed`: when the server advertises `tools.listChanged`, a long-lived watcher (`subscriptions/listen` on 2026-07-28, GET stream on 2025) opens after a sync, idle-closed after 6 h, in memory; also handled in-band during calls; (2) `refreshStale(actor)` for the mcp agent on session open (6 h cache); (3) unknown tool / invalid params on `callTool` → sync, the error message gets the current signature (or "no longer exists"); (4) UI refresh button.
- **Discovery** hides connectors without a usable credential for the actor, suspended/disabled ones, removed tools and tools `permissions.visibleToolIds` blocks. FTS5: words as prefix terms OR-ed, bm25 weighted path > keywords > description.
- `toScriptValue(result)` (exported): `structuredContent`, else a single text block parsed as JSON / text, else content blocks — the bridge should use it so runtime values match the `.d.ts`.
- Jobs: `connectors.oauth_flows` purges expired flows hourly.

## Contract changes (all additive)

`connectors/types.ts`: `DirectoryEntry` data fields; `ConnectorSummary.{label, displayName, canManage, canAuthenticate, protocolVersion}`; `ConnectorTool`, `ConnectorDetail`; `SyncResult.descriptionChanged`; `AddConnectorInput.{label, namespace}`; `RenameConnectorInput`; service methods `get`, `rename`, `disconnect`, `refreshStale`; `completeOAuth` optional `opts`. Search/describe filter blocked tools themselves now (contract JSDoc updated).

## Schema (`db/schema/connectors.ts`) — needs a migration (`pnpm db:generate`)

- `connector`: `label`, `protocol_version`, `server_info`, `tools_list_changed`.
- New table `upstream_oauth_flow`.

## UI library (additive)

- `ToolDefinition` (tool path, annotation badges, version, change warnings, reviewer note, signature in `CodeBlock`), exported from `index.ts`.
- `DataTable` `group` prop + `sortByGroup` / `groupHeaderAt` helpers (tested).
- `status.ts` tones: `connected`, `not_connected`, `verified`, `community`, `unverified`.

## Tests

`typegen.spec.ts` (37, incl. compiler type-checks and injection), `directory.spec.ts`, `upstream.spec.ts` (modern + legacy fake servers), `connectors.spec.ts` (real SQLite + FTS5, in-process fake MCP servers: no auth, token, OAuth with DCR/PKCE/refresh/revocation, list_changed, outputSchema/no outputSchema, annotations, personal connectors, two instances with different credentials, rename). Test DB helper `testing/db.ts` uses a temp file (libSQL `:memory:` loses data in transactions).

## Not done / follow-ups

- Live verification of directory URLs (no network here). Servers needing pre-registered OAuth clients (GitHub, possibly Vercel/Figma) use tokens; custom auth headers (e.g. Context7 keys) unsupported.
- Watchers are single-instance, in memory. Tool lists are per connector even for per-member credentials (different accounts on one personal connector share one definition set).
