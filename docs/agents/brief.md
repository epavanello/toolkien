# Agent brief (shared by every build agent)

Source of truth: `docs/spec.md` (Italian). Everything we write is in **English**, TypeScript strict. Chat with the author is Italian, but you only report to the orchestrator.

## Stack as scaffolded (do not re-scaffold)

- SvelteKit **3.x** (`@sveltejs/kit` ^3), Svelte 5 runes, adapter-node, Vite 8, config lives in `vite.config.ts` (no `svelte.config.js`).
- Env vars: declared in `src/env.ts` with `defineEnvVars`, imported from `$app/env/private` / `$app/env/public`; `building` from `$app/env`.
- Remote functions enabled (`query`, `query.live`, `query.batch`, `command`, `form` from `$app/server`). Files: `src/lib/functions/<domain>.remote.ts`. Use **`query.live`** (native, async generator) for real-time data — not a custom liveQuery.
- Imports use the subpath alias `#lib/...` (package.json `imports`), not `$lib`.
- Drizzle ORM + libSQL (`@libsql/client`); local dev `DATABASE_URL=file:local.db`, prod Turso (`DATABASE_AUTH_TOKEN`).
- Better Auth 1.7 (`better-auth`, `@better-auth/mcp`, `@better-auth/cimd`, `@better-auth/passkey`, `@better-auth/oauth-provider` installed).
- MCP SDK v2: `@modelcontextprotocol/server`, `@modelcontextprotocol/client` (2.4). Latest stable MCP spec: **2026-07-28** (no `Mcp-Session-Id`, no GET stream, `MCP-Protocol-Version` + `Mcp-Method`/`Mcp-Name` headers, elicitation via `InputRequiredResult`; CIMD preferred, DCR deprecated-but-allowed). Previous: 2025-11-25.
- UI: shadcn-svelte (style vega, `#lib/components/ui/*`), Tailwind 4, `@lucide/svelte`, `bits-ui`, `svelte-sonner`, `mode-watcher`, `runed`.
- **Button** at `#lib/components/ui/button` is custom (props `icon`, `iconAtEnd`, `loading`, auto-spinner when `onclick` returns a Promise). Never regenerate it. Add missing shadcn components with `pnpm dlx shadcn-svelte@latest add <name> --yes < /dev/null` (never `--overwrite` on button).
- Tests: Vitest (`pnpm vitest run <path>`), server tests `*.spec.ts` in node env. Deno for `runner/` and `egress/` (`deno test`). If `deno` is missing, write code + tests anyway and say so in your report.
- Format: prettier (tabs, single quotes, width 100). Lint: eslint.
- Dependencies are pre-installed. **Do not run `pnpm add`/`pnpm remove`** (parallel agents share `package.json`). If you truly need a package, stop and report it.

## UI philosophy (author's top priority)

Not a fixed rulebook, a way of working: presentation gets standardized inside shared library components (see the "UI" section of `docs/conventions.md`), and pages stay as lean as possible, composing those components and their predefined behaviors. When a page needs a kind of presentation the library lacks, grow the library (a variant or a generic component) instead of styling inside the page. The standard is meant to emerge from real needs, so prefer reusing and generalizing what exists over inventing parallel components. Shared library files are edited additively; mention what you added in your notes.

Content pages (legal, docs, future blog) are `+page.md` rendered by the standard markdown layout (mdsvex), not hand-styled Svelte pages.

## Reference conventions

Read `docs/conventions.md` (written by the foundation agent) before coding. Reference repos: the author's other SvelteKit projects were used as read-only references during the initial build (not part of this repository).

## Module map and ownership

Server code in `src/lib/server/<module>/`, each with `types.ts` (the contract), `index.ts` (public API), `*.spec.ts`. Modules only import other modules through their `index.ts`/`types.ts`.

| Vertical   | Owns                                                                                                                                                                                                                                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| foundation | `src/lib/server/db/**`, `src/lib/server/auth.ts`, `src/hooks*.ts`, `src/env.ts`, `src/app.*`, `src/lib/brand.ts`, `src/lib/core/**`, `src/lib/components/app/**` (shell), `src/routes/+layout*`, `src/routes/(auth)/**`, all `types.ts` contracts (initial version), `docs/conventions.md`, `DECISIONS.md`, `README.md` |
| infra      | `src/lib/server/crypto/**`, `src/lib/server/net/**`, `egress/**`, `deploy/**`, `Dockerfile`, `docker-compose.yml`, `docs/deploy-coolify.md`                                                                                                                                                                             |
| connectors | `src/lib/server/connectors/**`, `src/lib/server/typegen/**`, `src/lib/functions/connectors.remote.ts`, `src/routes/w/[workspace]/connectors/**`, `src/routes/w/[workspace]/directory/**`, upstream OAuth callback route                                                                                                 |
| runner     | `runner/**`, `src/lib/server/runner/**`                                                                                                                                                                                                                                                                                 |
| mcp        | `src/lib/server/mcp/**`, `src/routes/mcp/**`, `src/routes/.well-known/**`, `src/routes/(auth)/consent/**`, `docs/compatibility.md`                                                                                                                                                                                      |
| execution  | `src/lib/server/permissions/**`, `src/lib/server/bridge/**`, `src/lib/server/executions/**`, `src/lib/functions/{permissions,executions}.remote.ts`, `src/routes/w/[workspace]/permissions/**`, `src/routes/approve/**`                                                                                                 |
| org-ops    | `src/lib/server/{workspaces,audit,limits,jobs,account}/**`, `src/lib/functions/{workspaces,activity,account,admin}.remote.ts`, `src/routes/w/[workspace]/{activity,members,settings}/**`, `src/routes/(marketing)/**`, `src/routes/admin/**`, `legal/**`                                                                |

Rules:

- Edit only files you own. If a contract (`types.ts`) you consume is wrong, you may extend it **additively** and note it in your notes file; never break an existing signature.
- Schema: edit only your domain file in `src/lib/server/db/schema/`; do **not** run `drizzle-kit generate` (the integrator generates migrations). `pnpm db:push` against your own local db is fine.
- Shared docs: write your decisions and README fragments to `docs/notes/<vertical>.md`; the integrator merges them into `DECISIONS.md` and `README.md`.
- Never log, return or store upstream tokens, tool arguments, results or script code (except the encrypted durable-execution state).
- Before finishing: `pnpm vitest run <your paths>` green, `pnpm check` with zero errors in your files, prettier on your files.
- Your final report: what's done, what's stubbed/missing, contracts you changed, commands the user must run. Keep it under 300 words.

## Foundation handoff (read before coding)

- Remote functions start with `requireUser()` or `requireWorkspace(slug, minRole)` from `#lib/server/guards.ts`; pass the returned `actor` (`WorkspaceActor`) to services.
- UI library: `#lib/components/app/index.ts` (Page, DataTable, FilterBar, SidePanel, Section, KeyValueList, StatusBadge, PermissionBadge, UnverifiedBadge, Mono, CodeBlock, EmptyState, ConfirmDialog, FormDialog, FormField, RemoteForm, Stats, Toolbar, ...). Placeholder pages in `src/routes/w/[workspace]/*` show the pattern; replace the ones you own.
- Contracts: `src/lib/server/<module>/types.ts`; most `index.ts` throw `NotImplementedError` (`#lib/server/not-implemented.ts`) until the owner implements them. Already real: workspaces (listForUser/getBySlug/getById/hasRole), audit.record, limits.getLimits + in-memory rate limiter, jobs scheduler.
- Encrypted columns use the `sealed(prefix)` helper; the append-only audit trigger lives in `drizzle/0001_audit_guards.sql`. Tool search is the plain table `tool_search_text` (no FTS5/virtual tables: Turso MVCC rejects them).
- `/mcp` is bearer-only (never cookies). CSP has `form-action 'self'`. Login keeps `redirectTo` for the OAuth flow. CIMD fetches go through `net.safeFetch`.
- `(marketing)/+page.server.ts` redirects signed-in users to their workspace: keep that.
- **Do not `git commit`** (parallel agents share the index); the integrator commits.

## Product direction (added mid-build)

- Open source (license AGPL-3.0, confirmed by the author) + managed micro-SaaS; self-hosting is first-class (`docs/self-hosting.md`, compose works outside Coolify).
- Curated directory is community-contributed via pull requests: one file per server in top-level `directory/` (owned by connectors), schema-validated in tests.
- Technical docs: `(marketing)/docs/**` as markdown pages (org-ops), security described thoroughly.
- Landing: managed-service users first, self-hosters second.
