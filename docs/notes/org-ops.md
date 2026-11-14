# org-ops notes

Decisions, contract changes and integration hand-offs of the org-ops vertical (workspaces, audit, limits, jobs, account, admin, marketing, docs, legal). For the integrator to merge into `DECISIONS.md` / `README.md`.

## Decisions

### Workspaces and roles

- **Second factor = verified TOTP or ≥ 1 passkey** (`hasSecondFactor`). Enforced:
  - on **role grant**: creating a company workspace (creator becomes owner), `changeRole(→admin)`, accepting an **admin** invite, `transferOwnership` (target);
  - on **every admin action** (`assertAdminAction`): invites, role changes, removals, transfer, policy, rename, deletion, workspace kill switch, workspace-wide activity and CSV export. An admin who removes their factor keeps the role but loses the powers until they add one again (the UI shows a callout).
  - Account page refuses to remove the last factor of an owner/admin of a company workspace.
- **New error code** `SECOND_FACTOR_REQUIRED` in `#lib/core/errors.ts` (403), so the UI can link to account security.
- **Roles**: admins switch non-owner members between `member` and `admin`; `owner` moves only via `transferOwnership` (old owner → admin). Owner cannot leave or be removed. Personal workspaces cannot invite, have no policy UI and cannot be deleted on their own (they go with the account).
- **Members list** visible to every member (name, email, role); 2FA status only to admins.
- **Leaving / removal** deletes the member's own connectors in that workspace through `connectors.remove` (upstream revocation) and their credentials on shared "personal" connectors **locally** (no contract to revoke a single member credential upstream yet, see hand-offs). Their `mcp_active_workspace` row for that workspace goes too; permission rows are left (harmless, only restrict).
- **Invite links**: 32 random bytes base64url, SHA-256 stored; role `member`/`admin`, optional email restriction (case-insensitive), optional max uses, 1–30 days (default 7). Acceptance increments `use_count` with a conditional `UPDATE … WHERE use_count < max_uses AND not revoked AND not expired`, so concurrent accepts cannot exceed the limit. Public page `/invite/[token]` (in `(marketing)`, layout reset to `FocusFrame`).
- **Policy** (`checkConnectorPolicy`, pure): members may only add connectors _for themselves_ and only if `allowPersonalConnectors`; `allowFreeUrls` and `allowedServers` apply to everyone (admins edit the policy if they need an exception). `allowedServers` entries are directory ids or `https` origins (URLs normalised to origin).
- **Active workspace per (user, client)**: stored row if still a member, else the personal workspace. `setActiveWorkspace` checks membership; the caller records `workspace.switched`.
- **Deletion**: owner only, company only, confirmed by typing the slug. `deleteScheduledAt` = request time (per the column's doc); purge at `+7 days` by job `workspaces.purge` (hourly, runOnStart). Scheduled workspaces are refused by `assertNotSuspended` and their running executions are cancelled immediately. Purge removes connectors through the connectors contract (best effort), then deletes the organization (cascades). Audit rows stay until retention.

### Audit

- `query` keeps its contract; added `queryViews` (with user name), `timeline` (newest _N_ matching events, each touched execution completed with its sibling events, grouped by execution), `exportCsv` (≤ 50 000 rows, CSV-injection-safe), `purgeOlderThan(days, now)`, `anonymizeUser`, `deleteForWorkspaces`, `listForUser`.
- **Scope rules** in `audit/scope.ts` (not in `index.ts` to avoid a cycle with workspaces): members see only their own events; owners/admins see everyone with a second factor (personal workspaces: always).
- **Audit metadata never contains user ids** (it cannot be anonymised: the trigger only allows `user_id`/`approver_user_id` → NULL). Member-related events use the opaque `member.id`.
- New event types (TS enum only, no migration): `workspace.updated`, `workspace.deletion_cancelled`, `workspace.ownership_transferred`, `invite.revoked`, `platform.limits_changed`, `audit.exported`.
- Retention: job `audit.retention` (daily, runOnStart) with `auditRetentionDays` (env `AUDIT_RETENTION_DAYS`, overridable in `/admin`).
- **Technical logs are separate**: stdout/stderr only, ids but no personal data or content, **14 days**. The compose file currently rotates by size (`10m × 5`): infra should document/configure 14-day retention on the host (see hand-offs). Constant `TECHNICAL_LOG_RETENTION_DAYS` documents it.

### Limits, kill switch, usage, jobs

- `getLimits()` = env defaults merged with the `limits` platform setting (cached 30 s, invalid values ignored). `ExtendedLimits` adds `rateLimitWorkspaceExecPerMin` (600), `rateLimitIpPerMin` (120), `maxQueuedPerUser` (16), `auditRetentionDays`.
- Rate limits: `checkExecutionRateLimits` / `enforceExecutionRateLimits({ userId, workspaceId, ip })` (fixed window, per user → workspace → IP). `pruneRateLimits` job every 5 min.
- Concurrency: `SlotPool` (per-user + global, FIFO queue without head-of-line blocking, abortable, per-user queue cap → `RATE_LIMITED`). `acquireExecutionSlot` uses it; `concurrencySnapshot()` for `/admin`.
- **Kill switch** (`activateKillSwitch` / `releaseKillSwitch` / `listKillSwitches` / `assertNotSuspended`, active switches cached 15 s and invalidated on change):
  - user: `user.suspendedAt`, sessions deleted, MCP access/refresh tokens revoked, own connectors suspended, executions aborted + cancelled;
  - workspace: `organization.suspendedAt`, its connectors suspended, executions aborted + cancelled; members keep their sessions (read-only use of the web UI);
  - platform: all MCP tokens revoked, all sessions except platform admins' deleted, every execution aborted + cancelled; connectors untouched (everything is refused anyway).
  - Executions: `executions.abortRunning(scope)` (in-flight runner jobs) then `executions.cancel` for every running/paused row in scope. Listeners via `onKillSwitch`.
  - Connectors suspended by a switch get `suspendedAt = activatedAt`; release clears exactly those (manually suspended ones stay).
  - New column `kill_switch.origin` (`workspace_admin` | `platform_admin`): workspace admins can release only switches pulled by a workspace admin of their workspace.
  - `assertNotSuspended` also refuses workspaces scheduled for deletion and suspended connectors.
- Usage: `recordUsage(workspaceId, delta)` (upsert per UTC day), `getUsage`, `sumUsage`, `usageByWorkspace`.
- Jobs: scheduler moved to `jobs/scheduler.ts`; `jobs/index.ts` imports `jobs/builtin.ts`, where every job is registered (other verticals add theirs there). `listJobs()` added for `/admin`.

### Account

- Export (`/w/[workspace]/settings/account/export.json`): profile, passkeys (names), sessions, memberships, own connectors, which credentials exist (never values), own permission levels, MCP client consents, active workspaces, own audit events. Records `account.exported`.
- Deletion: refused (409) while the user owns a company workspace with other members. Otherwise deletes owned workspaces at once (personal + sole-member company, with upstream revocation via connectors), removes own connectors/credentials elsewhere, deletes audit rows of deleted workspaces, anonymises the rest, deletes the user (cascades). Requires typing the email and a session signed in within 24 h.
- Account page lives at `/w/[workspace]/settings/account` (no owned top-level route; keeps the shell). TOTP setup shows the secret + backup codes (no QR library installed); passkeys are added with `authClient.passkey.addPasskey()`.

### Platform admin

- `/admin` gated by `PLATFORM_ADMIN_EMAILS` (404 otherwise); every change also requires the admin's second factor. Shows totals, concurrency, kill switches (user by email, workspace by slug, platform), limits form, 30-day usage per workspace, jobs with "Run now".

### Marketing, docs, legal, SEO

- Open source (AGPL-3.0 assumed) + managed service: landing speaks first to managed-service users (code mode, security, teams, free early phase), then to self-hosters (source, Docker Compose/Coolify). `REPO_URL` in `src/routes/(marketing)/site.ts` is a **placeholder** (`github.com/toolkien/toolkien`).
- Docs under `src/routes/(marketing)/docs/**/+page.md`, nav from one data file `docs/nav.ts` (sidebar, prev/next, sitemap, llms.txt). Security docs are the detailed source; `legal/security.md` summarises and links to it.
- **Legal drafts**: source in `legal/*.md` (root), rendered at `/legal/<slug>` by `(marketing)/legal/[document]/+page.ts`, which `import.meta.glob`s them; mdsvex compiles them through the standard markdown layout (no duplicated `+page.md`). Each starts with the review disclaimer (tested). Placeholders in bold brackets (`[Operator legal name]`, contacts, VPS provider, liability cap, governing law…).
- SEO: `#lib/components/seo/seo-head.svelte` (title, description, canonical, OG, Twitter, robots, JSON-LD) and `json-ld.svelte` (`schema-dts` types, `<` escaped). Used by landing, docs/legal (via the markdown layout, `TechArticle`), login/signup, invite and admin (noindex). The app `Page` component now emits `noindex`.
- Routes (all in `(marketing)`, URLs at the root): `robots.txt` (disallows `/w/`, `/admin`, `/approve`, `/invite/`, `/consent`, `/two-factor`, `/api/`, `/mcp`), `sitemap.xml`, `llms.txt`, `llms-full.txt` (raw docs + legal markdown), `site.webmanifest`, `icon.svg` (neutral monogram). `static/robots.txt` was **removed** (it shadowed the route).
- **No OG image endpoint**: needs satori/resvg (not installed). `SeoHead` emits `summary` cards without an image until one exists.

## UI library additions (additive)

- `app/`: `Timeline` (+ `TimelineItem`, expandable groups), `Callout` (info/warning/danger notice with action), `RevealDialog` (show-once values with copy); `FilterBar` and `DataTable` gained `searchable={false}`; `FormField` gained `checked` (checkbox) and `value` for number/select; `status.ts` tones `missing`, `used`, `revoked`, `released`; `Page` emits `<meta name="robots" content="noindex">`.
- `markdown/markdown-layout.svelte`: uses `SeoHead` + JSON-LD, accepts `updated` as Date (YAML), exports `embedMarkdownPages()` so a frame (docs) renders articles without the outer container.
- New `marketing/`: `SiteHeader`, `SiteFooter`, `Hero`, `MarketingSection` (tone `muted`), `FeatureGrid`, `Steps`, `DocsShell`.
- New `seo/`: `SeoHead`, `JsonLd`.

## Contract changes (all additive)

- `workspaces/types.ts`: `DELETION_GRACE_DAYS`, `GrantableRole`, `MemberSummary`, `InviteLink*`, `CreateInviteInput`, `InvitePreview`, `PolicyInput`, `PolicyCheck`, `ConnectorPolicyInput`, `DeletionState`. Implemented `getActiveWorkspace`, `setActiveWorkspace`, `getPolicy`.
- `audit/types.ts`: `TECHNICAL_LOG_RETENTION_DAYS`, `AuditEventView`, `ActivityFilters`, `TimelineEntry`. Implemented `query`, `purgeOlderThan`.
- `limits/types.ts`: `ExtendedLimits`, `LimitKey`, `KillSwitchSummary`, `ActivateKillSwitchInput`, `KillSwitchListener`, `UsageDelta`, `UsageRow`, `ConcurrencySnapshot`. `acquireExecutionSlot` and `assertNotSuspended` are now real.
- `jobs/types.ts`: `JobStatus`.
- New `account/types.ts`: `AccountExport`, `DeletionBlocker`.
- Schema: `kill_switch.origin` (**needs a migration**); audit event enum extended (TS only).

## Hand-offs

- **integrator**: generate the migration for `kill_switch.origin` (`text NOT NULL DEFAULT 'platform_admin'`; I added it to my `local.db` by hand). Add LICENSE (AGPL-3.0). Replace legal placeholders and `REPO_URL` before launch.
- **mcp**: call `assertNotSuspended({ userId, workspaceId })` on every `/mcp` request (JWT access tokens may not consult the `revoked` column); use `getActiveWorkspace` / `setActiveWorkspace` and record `workspace.switched`.
- **execution**: call `enforceExecutionRateLimits({ userId, workspaceId, ip })`, `acquireExecutionSlot(userId, signal)` and `recordUsage(workspaceId, …)`; register `executions.expire` in `src/lib/server/jobs/builtin.ts`.
- **connectors**: enforce `checkConnectorPolicy(await getPolicy(workspaceId), actor.role, input)` on add. Missing contract: revoke **one member's** credential upstream (`revokeUserCredentials(workspaceId, userId)`); today removal/account deletion delete those rows locally.
- **foundation**: link "New company workspace" (→ `/w/[slug]/settings`) in the workspace switcher and "Account" (→ `/w/[slug]/settings/account`) in the user menu; the favicon is still the Svelte logo (`/icon.svg` exists); optionally an `X-Robots-Tag: noindex` header for app paths.
- **infra**: keep technical logs 14 days (compose rotates by size today), and say so in `docs/deploy-coolify.md`; `docs/self-hosting` summarises that guide.

## Tests

`pnpm vitest run --project server src/lib/server/{workspaces,audit,limits,jobs,account} "src/routes/(marketing)"` (35 tests): roles and second-factor enforcement, owner protection and transfer, invite links (hash, max uses, email, expiry, revocation, admin 2FA), policy normalisation/enforcement/audit, active workspace fallback, deletion grace + purge, timeline grouping, CSV escaping/export, cursor pagination, retention purge, anonymisation vs append-only trigger, kill switches (user/workspace/platform, release rules, connector restore), slot pool, rate limits, limit overrides, usage, account export/deletion, docs/legal content and disclaimers. `src/lib/server/workspaces/test-db.ts` gives any vertical an in-memory database with the current schema (`vi.mock('#lib/server/db/index.ts', …)`).
