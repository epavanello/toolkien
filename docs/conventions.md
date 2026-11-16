# Conventions

Derived from the author's projects (most recent wins on conflicts): **hi-cherries** (SvelteKit 3, Turso, Better Auth organizations, `#lib`), **how-much** (MCP + Better Auth OAuth) and **devmotion** (MCP, security headers, CSRF exemptions). Read this before writing code; `docs/agents/brief.md` has ownership rules.

## Folder structure

```
src/
├── env.ts                       # every env var, documented (defineEnvVars)
├── hooks.server.ts              # security headers, CSRF, session → locals, handleError, jobs
├── app.d.ts / app.html          # App.Locals / App.Error; mode script with CSP nonce
├── lib/
│   ├── brand.ts                 # product name + taglines (single source)
│   ├── navigation.ts            # workspace sidebar sections (single source)
│   ├── auth-client.ts           # browser Better Auth client (passkeys, Google redirect)
│   ├── core/                    # isomorphic helpers: attempt, remote-errors, errors, format, redirects
│   ├── components/
│   │   ├── ui/                  # shadcn-svelte (style vega) — Button is custom, never regenerate
│   │   ├── app/                 # the app component library (see UI) + shell
│   │   └── markdown/            # mdsvex layout for +page.md
│   ├── functions/               # remote functions: <domain>.remote.ts
│   └── server/
│       ├── auth.ts              # Better Auth instance
│       ├── guards.ts            # requireUser(), requireWorkspace(slug, minRole)
│       ├── db/{index.ts,schema/}# Drizzle client; one schema file per domain
│       └── <module>/            # types.ts (contract) + index.ts (public API) + *.spec.ts
└── routes/
    ├── (marketing)/             # landing (/), legal and docs as +page.md
    ├── (auth)/                  # login, signup, two-factor, consent
    └── w/[workspace]/<section>/ # the app, one folder per sidebar section
```

Server modules talk to each other only through `index.ts` / `types.ts`. Contracts live in `types.ts`, with JSDoc stating invariants.

## Naming and imports

- Files kebab-case (`workspace-switcher.svelte`), types PascalCase, functions camelCase, route params camelCase.
- Imports use the `#lib/...` subpath alias **with the extension**: `.ts` for TypeScript (`#lib/server/auth.ts`), `.svelte` for components; generated shadcn files use `#lib/utils.js`, leave them. `$lib` does not exist.
- Env vars: declared in `src/env.ts`, imported from `$app/env/private` (`$app/env/public` for public ones). `building` / `dev` from `$app/env`. Never `process.env` in app code (only `drizzle.config.ts`).
- Links: `resolve()` from `$app/paths` with route ids: `resolve('/w/[workspace]/connectors', { workspace })`, `resolve('/(auth)/login')`. `goto` must always use `resolve` (lint rule).
- All text in English, hard-coded in components (no i18n).

## Remote functions

Files `src/lib/functions/<domain>.remote.ts`; `query`, `query.live`, `query.batch`, `command`, `form` from `$app/server`.

- **Guard first**: every function starts with `requireUser()` or `requireWorkspace(slug, minRole)` from `#lib/server/guards.ts` (plain server functions, they throw `App.Error`). `requireWorkspace` returns `{ workspace, actor }`; pass `actor` (`WorkspaceActor`) to services. Never trust a slug or id from the client without it.
- **Validation**: Zod 4 schemas as the first argument. Custom messages are user-facing (`handleError` forwards the first `custom` issue).
- **Commands refresh on the server** (single flight): `void listConnectors(slug).refresh()` inside the command.
- **Live data** (execution status, pending approvals, activity): native `query.live` with an async generator, not a custom liveQuery:

  ```ts
  export const watchExecution = query.live(z.string(), async function* (id) {
  	const user = requireUser();
  	while (true) {
  		const execution = await status({ userId: user.id, executionId: id, resume: false });
  		yield execution;
  		if (execution.status !== 'running' && execution.status !== 'awaiting_approval') return;
  		await new Promise((r) => setTimeout(r, 1000));
  	}
  });
  ```

- Query proxies: `const items = $derived(await getItems(slug))` (top-level await, wrap the route in `Boundary`). Never `$derived(getItems())` without `await`.
- Forms: `form(schema, handler)`, rendered with `RemoteForm` + `FormField`. Use `invalid(message)` for form-level errors, `redirect(303, …)` to navigate.
- Client: event handlers stay one line with `attempt(promise, successToast?)` (`#lib/core/attempt.ts`); `Button` shows the spinner while an `onclick` promise is pending.
- Svelte 5 runes only; prefer `watch()` from `runed` over `$effect`.

## Better Auth

`src/lib/server/auth.ts`: drizzle sqlite adapter, no passwords (`emailAndPassword` disabled), plugins `organization()` (workspace = organization, roles owner/admin/member, extra fields `kind`, `deleteScheduledAt`, `suspendedAt`, deletion disabled in favour of our grace period), optional Google `socialProviders` (only with `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`, OAuth tokens encrypted), `passkey()`, `magicLink()` + `emailOTP()` (one email with link + code, sent by `#lib/server/email`; their HTTP endpoints are disabled and `#lib/server/email-sign-in.ts` calls them server-side), `jwt()`, `mcp()` (OAuth 2.1 AS for MCP clients, resource `${ORIGIN}/mcp`, 15 min access tokens, 30 day rotating refresh tokens, DCR allowed), `cimd()` (fetches through `net.safeFetch`), and `sveltekitCookies` **last**.

- Every new user gets a personal workspace (`databaseHooks.user.create.after` → `ensurePersonalWorkspace`, idempotent; `/` calls it again).
- `locals.user` / `locals.session` come from the cookie session in `hooks.server.ts`; suspended users are treated as signed out. `/mcp` never reads cookies (bearer only).
- After adding a plugin or field: `pnpm auth:schema` regenerates `src/lib/server/db/schema/auth.ts` (do not edit it by hand), then a migration.

## Database, schema and migrations

- Drizzle + libSQL: `DATABASE_URL=file:local.db` locally, Turso in production (`drizzle.config.ts` picks `sqlite` vs `turso`).
- One schema file per domain in `src/lib/server/db/schema/` (`auth`, `workspaces`, `connectors`, `permissions`, `executions`, `audit`, `platform`), re-exported by `index.ts`. Helpers in `columns.ts`: `id()` (UUID), `createdAt(name?)`, `updatedAt()`, `timestamp()`, `json<T>()`, `sealed(prefix)` (ciphertext + nonce + key version of a value encrypted with the workspace key).
- Enums are `as const` arrays exported next to the table (`EXECUTION_STATUSES`) and reused by contracts.
- Nullable-scoped uniqueness uses two partial unique indexes (`… where user_id is null` / `is not null`): SQLite treats NULLs as distinct, and drizzle-kit cannot render `coalesce()` expressions.
- Migrations are the only schema path (dev, prod, tests: `#lib/server/db/testing.ts`): `pnpm db:generate`, `pnpm db:migrate`; a spec fails when the schema drifts. Things drizzle-kit cannot express go in a custom migration (`pnpm db:generate --custom --name <x>`): the append-only trigger on `audit_event` lives in `drizzle/0001_audit_guards.sql`. Production is Turso in MVCC mode: no virtual tables (so no FTS5) and no SQLite-only pragmas or table-valued functions (`pragma_compile_options`, …) in migrations or runtime code; triggers are fine.
- Content (tokens, script code, tool arguments/results) is stored only sealed and wiped when no longer needed. Everything else is metadata.

## Errors

- `App.Error` = `{ code: ErrorCode; message: string }`; codes in `#lib/core/errors.ts` (`UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INVALID_INPUT`, `RATE_LIMITED`, `SUSPENDED`, `POLICY_DENIED`, …). Throw with `error(status, 'User-facing message.', { code: 'FORBIDDEN' })`. Add codes there when needed.
- `handleError` forwards app errors, maps validation errors to `INVALID_INPUT`, and turns unknown errors into a generic message (logged server side). Messages of 4xx are shown to users (`remoteErrorMessage`), 5xx never are.
- Never log or return tokens, tool arguments, results, script code or upstream bodies — including in errors and audit metadata.
- Contract stubs throw `NotImplementedError` (`#lib/server/not-implemented.ts`).

## Security defaults

- CSP via `kit.csp` in `vite.config.ts` (nonces for scripts, `frame-ancestors 'none'`, `form-action 'self'`); other headers (HSTS in production, `X-Frame-Options`, `nosniff`, Referrer/Permissions/COOP) in `#lib/server/security.ts`.
- CSRF: SvelteKit's origin check is replaced by `isCrossSiteFormRequest` in hooks so the OAuth token/register/revoke/introspect endpoints accept form posts from non-browser MCP clients. Everything else still requires a same-origin `Origin` for form content types.
- Redirect targets from the client go through `safeRedirectPath`.

## UI

**Philosophy: pages compose, the library presents.** Presentation (spacing, typography, colors, states, responsive behaviour) lives in `#lib/components/app/` as components with `tailwind-variants` variants. Pages pass data, variants and one-line handlers; they contain no class soup and no ad-hoc layout. When a page needs a look the library lacks, add a **variant** (or a small component) to the library — never style it inside the page. The library grows from real needs: build what a page needs, keep it generic and composable.

A page should read like this:

```svelte
<script lang="ts">
	import { DataTable, Page, type Column } from '#lib/components/app/index.ts';
	import { listConnectors } from '#lib/functions/connectors.remote.ts';
	import { page } from '$app/state';

	const rows = $derived(await listConnectors(page.params.workspace!));
	const columns: Column<(typeof rows)[number]>[] = [
		{ key: 'name', header: 'Name' },
		{ key: 'namespace', header: 'Namespace', type: 'mono' },
		{ key: 'status', header: 'Status', type: 'status' }
	];
</script>

<Page title="Connectors" description="Remote MCP servers available in this workspace.">
	<DataTable label="Connectors" {rows} {columns} rowKey={(r) => r.id} />
</Page>
```

What exists today (`#lib/components/app/index.ts`):

| Need                                                             | Component                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page frame (title, description, meta badges, actions, back link) | `Page` — variants `list` (full width) · `detail` · `form` · `narrow`                                                                                                                                                                                                                                                                   |
| Grouped content                                                  | `Section` — `card` · `plain` · `flush` (tables/lists inside), tone `danger`                                                                                                                                                                                                                                                            |
| Lists                                                            | `DataTable` (search, select filters, pagination, loading/error/empty, row click + Enter; column types `text` `mono` `badge` `status` `datetime` `number` `actions`, `logo` for a service logo before the value, `group` with `{ label, logo }` headers, `cell` snippet as escape hatch); `FilterBar` and `Toolbar` for non-table lists |
| Details                                                          | `SidePanel` (sheet, sizes `md`/`lg`/`xl`), `KeyValueList` (1 or 2 columns, value types)                                                                                                                                                                                                                                                |
| Status and labels                                                | `StatusBadge` (raw domain value → tone via `status.ts`), `PermissionBadge` (allow/ask/block, "to confirm"), `UnverifiedBadge`, `Badge` variants `success`/`warning`/`destructive`                                                                                                                                                      |
| Code                                                             | `Mono` (ids, tool paths; `copy`, `truncate`), `CodeBlock` (TS signatures, `.d.ts`), `CopyButton`                                                                                                                                                                                                                                       |
| States                                                           | `EmptyState` (`inline`/`page`, `art` for a brand illustration), `ErrorState`, `Boundary` (pending + failed for awaited queries)                                                                                                                                                                                                        |
| Numbers                                                          | `Stats`                                                                                                                                                                                                                                                                                                                                |
| Dates                                                            | `RelativeTime` (`2 min ago`, `yesterday`, `3 Nov`; live while recent; full date in the viewer's locale as tooltip; `<time datetime>`); `Callout` `time` for a date after a notice title                                                                                                                                                |
| Services                                                         | `ServiceLogo` (connector / directory server logo, sizes `xs`–`lg`, `withName`; monogram fallback); `Section` / `SidePanel` `media` slot to put it before a title                                                                                                                                                                       |
| Actions                                                          | `ActionsMenu` ("⋯"), `ConfirmDialog` (`onConfirm` → `attempt(...)`), `FormDialog`, `RemoteForm`, `FormField`                                                                                                                                                                                                                           |

Tools and permissions: `ToolDefinition` (signature on demand, `aside` slot), `ToolGroupList` (rows under read only / write / destructive / not declared headers; `tool-groups.ts` is the only classification), `ToolPermissionRow` (the one place a tool's level is shown and edited, on the permissions page and in the connector panel; saves through `setToolLevel`), `Disclosure` `flush` for one collapsible list among many.

Rules:

- Colors are tokens from `src/routes/layout.css` only: ink/paper neutrals, one accent (`primary`, ember), semantic `success` / `warning` / `destructive`; brand-only `ember` / `brass` / `ink` / `paper` for logo, art and marketing bands. Map domain statuses to tones in `status.ts`, once. Brand rules: `docs/brand.md`.
- Monospace (`mono` utility / `Mono`) for ids, tool paths and TypeScript.
- **Dates are relative.** Every date the app shows goes through `RelativeTime` (directly, or via the `datetime` type of `DataTable` / `KeyValueList`, `Timeline`, `Callout` `time`): never `formatDateTime`, `toLocale*` or a raw ISO string in a page. `YYYY-MM-DD` values are calendar dates (`today`, `3 Nov`). Exceptions: files (CSV/JSON exports keep ISO timestamps) and the "Last updated" line of legal/docs markdown pages (an absolute revision date).
- **Services show their logo.** Wherever a connector or directory server is named, show `ServiceLogo` with the icon URL Toolkien serves (`ConnectorSummary.icon`, `DirectoryEntry.icon`). Never hotlink a third-party image: directory icons are committed PNGs (`directory/icons/`), free-URL favicons are fetched server side and served by `/connectors/icon/[id]`.
- Dense by default: `text-sm`, 36px table rows, small radii. Light/dark via `mode-watcher` (the pre-paint script is in `app.html` for the CSP nonce).
- Keyboard and WCAG AA: every interactive element is a real button/link or has `tabindex` + Enter/Space; icon-only buttons have `aria-label`; tables have `label`.
- Personality lives in the landing, auth, empty states, error pages, onboarding and docs titles: the logo (`Logo`), spot illustrations (`BrandArt`, or `art` on `EmptyState` / `DataTable` / `Timeline` empty states) and the display face (`font-display`, Fraunces). Data views, forms and settings stay plain: no art, no display face, no gratuitous animation.
- `class` passed from a page is for layout placement only, and rarely.
- Markdown pages (`+page.md`: legal, docs, blog) contain only markdown + frontmatter (`title`, `description`, `updated`); `components/markdown/markdown-layout.svelte` renders them.

## Tests, lint, format

- Vitest: server/unit tests `*.spec.ts` (node), component tests `*.svelte.spec.ts` (browser, Playwright chromium, `vitest-browser-svelte`). Run `pnpm vitest run <path>`; `pnpm test` runs both projects. Test pure logic next to the module (`data-table.ts`, `security.ts`, contracts' helpers).
- Deno tests for `runner/` and `egress/`.
- `pnpm check` (svelte-check, 0 errors), `pnpm lint` (prettier check + eslint), `pnpm format`. Prettier: tabs, single quotes, width 100, no trailing commas. ESLint: unused vars allowed only with a `_` prefix; `goto` must use `resolve`.
