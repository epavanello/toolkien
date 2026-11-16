---
title: Self-hosting
description: Run your own Toolkien with one Docker Compose stack, on any server or on Coolify.
updated: 2026-11-14
---

Toolkien is open source under **AGPL-3.0**. The managed service is the easiest way to use it; self-hosting gives you the same product on your own infrastructure. When you self-host, **you** are the controller (and processor) of your users' data, and our managed-service legal terms do not apply to your instance.

## What you run

Two Docker Compose stacks. The app stack:

- **app**: the SvelteKit application (web UI, OAuth server, MCP endpoint, bridge). The only public service.
- **egress-proxy**: the single exit to upstream MCP servers.
- **runner**: Deno supervisor that runs each script in a permission-less process, on an internal-only network.

And, deployed once and left alone, the **OpenBao** stack: the secrets engine (transit) that wraps per-workspace data keys, on its own internal network with a persistent volume, never in dev mode. It is separate because it is sealed after every restart, so app upgrades never restart it.

Small private instances can skip OpenBao and set `TOOLKIEN_MASTER_KEY` instead: no unseal step, but anyone who can read the app's environment can decrypt every stored credential.

The database is libSQL: a Turso database (pick an EU region if you serve EU users) or a local file for small installs.

## Requirements

- A Linux server with Docker and Docker Compose, or a Coolify instance.
- A domain with TLS in front of the app (Coolify's proxy, Traefik or Caddy).
- A Turso database URL and token, or a `file:` database on a volume.

## Steps in short

1. Clone the repository and copy `deploy/compose.env.example` to an env file; set `ORIGIN`, `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PLATFORM_ADMIN_EMAILS` and the runner secret. Optionally set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (redirect URI `ORIGIN/api/auth/callback/google`) to offer "Continue with Google".
2. Start the OpenBao stack (`deploy/openbao/compose.yml`) and initialise it once with the provided script: it creates the transit key and the AppRole for the app, prints the unseal keys (keep them **offline**) and revokes the root token. Put the AppRole `role_id` and `secret_id` in the app's environment.
3. Start the app stack: `docker compose --env-file .env.production up -d --build`. On Coolify, two Docker Compose resources.
4. Unseal OpenBao after a server reboot with the provided script (app deploys do not restart it).
5. Run the database migrations, sign up, and use the platform admin panel at `/admin` (for emails listed in `PLATFORM_ADMIN_EMAILS`) to tune limits.

The repository's `docs/deploy-coolify.md` is the step-by-step guide, including backups (Turso point-in-time restore plus a daily encrypted export, with a documented restore test) and OpenBao snapshots kept separate from database backups.

## Operating notes

- **Single instance**: rate limits, queues and scheduled jobs live in memory. Do not run two app instances at once (no rolling deploys with overlap).
- Configuration is only through environment variables; nothing secret lives in the repository.
- Logs: activity logs are kept for `AUDIT_RETENTION_DAYS` (90); configure your container log rotation to keep technical logs for 14 days.
- Keep the legal pages of your instance accurate: the drafts in `legal/` describe the managed service.
