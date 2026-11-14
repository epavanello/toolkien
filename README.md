# Toolkien

_One MCP to rule them all._ An MCP gateway in "code mode": connect one MCP server to your clients (Claude, Codex, Cursor…) and use every remote MCP server configured on the platform, through typed discovery and TypeScript scripts run in a Deno sandbox, with explicit permissions and human approvals.

- Product spec: `docs/spec.md` · Conventions: `docs/conventions.md` · Decisions: `DECISIONS.md`

## Stack

SvelteKit 3 (Svelte 5, adapter-node, remote functions), Better Auth (organizations, passkeys, 2FA, OAuth 2.1 provider for MCP), Drizzle + libSQL/Turso, OpenBao transit (envelope encryption), Deno runner, egress proxy, shadcn-svelte + Tailwind 4.

## Setup

Requirements: Node 22+, pnpm 10+, `sqlite3` (optional, for inspection), Deno 2 (runner and egress only).

```sh
pnpm install
cp .env.example .env            # then fill the secrets:
#   BETTER_AUTH_SECRET=$(openssl rand -base64 32)
#   TOOLKIEN_DEV_MASTER_KEY=$(openssl rand -base64 32)
#   RUNNER_SHARED_SECRET=$(openssl rand -hex 32)
pnpm db:migrate                 # creates local.db with all migrations
pnpm exec playwright install chromium   # browser for component tests (once)
```

## Develop

```sh
pnpm dev            # http://localhost:5173 — sign up, you land in your personal workspace
pnpm check          # svelte-check (types)
pnpm lint           # prettier --check + eslint
pnpm format         # prettier --write
pnpm test           # vitest: server (node) + component (browser) projects
pnpm build          # production build (adapter-node)
```

## Database

```sh
pnpm db:generate    # migration from schema changes (src/lib/server/db/schema/*)
pnpm db:migrate     # apply migrations
pnpm db:studio      # browse the database
pnpm auth:schema    # regenerate the Better Auth tables after changing auth plugins
```

Custom SQL (FTS5 tool search, audit append-only trigger) lives in `drizzle/0001_search_and_audit_guards.sql`. Production uses Turso: set `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN`.

## Environment

Every variable is declared and documented in `src/env.ts`; `.env.example` lists them with local defaults. Nothing secret is committed.
