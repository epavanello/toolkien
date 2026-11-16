# Toolkien

_One MCP to rule them all._ Toolkien is an MCP gateway in "code mode": connect one MCP server to
your clients (Claude, Codex, Cursor…) and use every remote MCP server configured in your
workspace. Instead of hundreds of tool definitions, the agent searches tools, reads their
TypeScript declarations and runs one TypeScript script in a Deno sandbox. Every call is checked
against explicit permissions; writes can pause for a human approval and resume without repeating
calls. Tokens are encrypted, content is never logged.

Open source (AGPL-3.0) and available as a managed service. Product spec: `docs/spec.md` (Italian) ·
Decisions: `DECISIONS.md` · Conventions: `docs/conventions.md` · Client compatibility:
`docs/compatibility.md`.

## Architecture

| Part                         | What it does                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **App** (SvelteKit 3)        | Web UI, `/mcp` (Streamable HTTP, MCP 2026-07-28 and 2025-11-25), OAuth 2.1 authorization server for MCP clients (Better Auth), connectors, permissions, executions |
| **Database** (libSQL)        | Turso in production, a local file in development; Drizzle migrations in `drizzle/`                                                                                 |
| **OpenBao**                  | Transit key that wraps one data key per workspace (envelope encryption of credentials and paused executions)                                                       |
| **Runner** (`runner/`)       | Deno supervisor: type-checks scripts in a sandboxed TypeScript compiler, runs each one in a permission-less Deno process; tool calls come back to the app's bridge |
| **Egress proxy** (`egress/`) | The only way out to upstream MCP servers and the email provider (CONNECT, port 443, SSRF rules)                                                                    |
| **Email** (Resend)           | Passwordless sign-in (code + link) and workspace invitations                                                                                                       |

Flow: the agent calls `tools_search` → `tools_describe` → `execute`. The app resolves the
workspace and the visible tools, generates `.d.ts` declarations, and sends the script to the
runner over a WebSocket. Each tool call goes through the bridge: kill switches, permission level
(allow / ask / block), approval gate, encrypted credential, upstream call, sealed result for
durable replay, audit (metadata only).

## Local development

Requirements: Node 22+, pnpm 10 (`corepack enable` picks the pinned version), Deno 2.

```sh
pnpm install
cp .env.example .env    # then fill:
#   BETTER_AUTH_SECRET=$(openssl rand -base64 32)
#   TOOLKIEN_DEV_MASTER_KEY=$(openssl rand -base64 32)
# Leave RUNNER_URL empty: the app starts a local runner with your `deno`.
# Leave RESEND_API_KEY empty: sign-in codes and links are printed to the server console.
pnpm db:migrate         # creates local.db from the migrations
pnpm dev                # http://localhost:5173 — sign up with any email, you land in your personal workspace
```

Or in one step (fresh clones, Claude Code cloud sessions): `bash scripts/cloud-setup.sh` installs
the dependencies (Deno and the test Chromium included), writes a dev `.env` with random secrets,
migrates and seeds `local.db`. It is idempotent.

Seed data (`pnpm db:seed`, or `pnpm db:reset` to start over): `alice@toolkien.test` (platform
admin when listed in `PLATFORM_ADMIN_EMAILS`), `bob@toolkien.test`, `carol@toolkien.test`, each
with a personal workspace, plus the `acme` workspace (owner, admin, member) with a synced "Dev MCP"
connector. `pnpm dev:mcp` serves that connector (`http://localhost:8788/mcp`: echo, numbers,
in-memory notes, a destructive tool for approvals, a failing tool). Sign-in codes print to the
`pnpm dev` console; each address gets 5 codes per 15 minutes.

Connect a client: add `http://localhost:5173/mcp` as a remote MCP server (Streamable HTTP). It
discovers OAuth, opens the consent page and asks which workspace to start in. For a local MCP
server to connect to, development (only) accepts `http://localhost…` connector URLs.

Useful commands:

```sh
pnpm check                  # svelte-check
pnpm lint                   # prettier --check + eslint
pnpm test                   # vitest: server (node) + component (browser) projects
pnpm build                  # production build (adapter-node)
pnpm db:generate            # migration from schema changes (src/lib/server/db/schema/*)
pnpm db:seed                # seed local.db (idempotent); pnpm db:reset = delete, migrate, seed
pnpm dev:mcp                # local MCP server for the seeded "Dev MCP" connector
pnpm auth:schema            # regenerate Better Auth tables after changing auth plugins
pnpm directory:validate     # check directory/servers/*.json
cd runner && deno task test # runner (sandbox, checker, escape attempts)
cd egress && deno task test # egress proxy
pnpm exec playwright install chromium   # once, for component tests
```

Every environment variable is declared and documented in `src/env.ts`.

## Self-hosting

One `docker compose` project (app, OpenBao, egress proxy, runner): see
[`docs/self-hosting.md`](docs/self-hosting.md), and [`docs/deploy-coolify.md`](docs/deploy-coolify.md)
for Coolify. Migrations run when the app container starts.

## Contributing to the directory

The curated server directory is data: one JSON file per server in `directory/servers/`. Read
[`directory/CONTRIBUTING.md`](directory/CONTRIBUTING.md), add or edit a file, run
`pnpm directory:validate`, open a pull request.

## Before launch

Placeholders that need real values:

The repository URL is `REPOSITORY_URL` in `src/lib/brand.ts`.

- Legal drafts in `legal/*.md`: operator legal name and address, privacy / DPO / security /
  contact emails, VPS provider and region, Resend legal entity, transfer mechanism and sending
  region, liability cap, governing law, notice periods. All drafts need review by a lawyer or DPO.
- Resend: verified sender domain (EU region), `EMAIL_FROM`, an API key with sending access only.
- VPS provider (EU) for the compose stack; Turso database in an EU region.
- OG image endpoint (not implemented).

## License

[AGPL-3.0](LICENSE). If you run a modified Toolkien as a network service, you must offer its
source to its users.
