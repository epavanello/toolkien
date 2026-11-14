# Self-hosting Toolkien

Toolkien is one `docker compose` project: the app (SvelteKit), OpenBao (encryption keys), an
egress proxy (the only way out to upstream MCP servers) and the runner (Deno sandbox for
scripts). On Coolify, follow [`deploy-coolify.md`](deploy-coolify.md) instead; the compose file
is the same.

## Requirements

- Linux host, Docker Engine 25+ with Compose v2, 2 vCPU / 4 GB RAM minimum, swap off.
- A domain name and a TLS reverse proxy on the host (Caddy is the simplest).
- A libSQL database: [Turso](https://turso.tech) (EU region recommended) or your own
  `sqld` (libSQL server).
- Optional, recommended: [gVisor](https://gvisor.dev) (`runsc` runtime) for the runner.
- On a workstation, not the server: `age` for backup keys.

## Configuration

```sh
git clone <repo> /opt/toolkien && cd /opt/toolkien
cp deploy/compose.env.example .env.production && chmod 600 .env.production
```

| Variable                                                                                        | Required | Notes                                                     |
| ----------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------- |
| `ORIGIN`                                                                                        | yes      | Public URL, no trailing slash. Also the OAuth issuer.     |
| `DATABASE_URL`, `DATABASE_AUTH_TOKEN`                                                           | yes      | `libsql://…` and its token                                |
| `BETTER_AUTH_SECRET`                                                                            | yes      | `openssl rand -base64 32`                                 |
| `RUNNER_SHARED_SECRET`                                                                          | yes      | `openssl rand -hex 32` (app ↔ runner)                     |
| `EGRESS_PROXY_TOKEN`                                                                            | yes      | `openssl rand -hex 32` (app ↔ egress proxy)               |
| `OPENBAO_ROLE_ID`, `OPENBAO_SECRET_ID`                                                          | yes\*    | Printed by `init.sh` on first boot                        |
| `RESEND_API_KEY`, `EMAIL_FROM`                                                                  | yes      | Sign-in email (code + link) and invitations, see below    |
| `PLATFORM_ADMIN_EMAILS`                                                                         | no       | Access to `/admin` (limits, kill switches)                |
| `APP_PUBLISH`                                                                                   | no       | Host port for the reverse proxy, default `127.0.0.1:3000` |
| `APP_DOMAIN`, `PUBLIC_NETWORK*`, `TRAEFIK_CERT_RESOLVER`                                        | no       | Only with Traefik (Coolify raw mode)                      |
| `EXEC_*`, `RATE_LIMIT_EXEC_PER_MIN`, `AUDIT_RETENTION_DAYS`                                     | no       | Limits, see `src/env.ts`                                  |
| `APP_MEMORY`, `RUNNER_CPUS`, `RUNNER_MEMORY`, `RUNNER_MAX_CONCURRENT`, `EGRESS_MAX_CONNECTIONS` | no       | Resources                                                 |

Every app variable is documented in `src/env.ts`. The app refuses to start in production
without OpenBao (`OPENBAO_ADDR` is set by the compose file).

Email: sign-in is passwordless (an emailed 6-digit code and a single-use link, or a passkey),
so the app needs a transactional email provider. Toolkien talks to the [Resend](https://resend.com)
HTTP API: create an API key with sending access only, verify your sender domain (pick the EU
region for the domain), and set `EMAIL_FROM` to an address on it. `RESEND_BASE_URL` overrides the
API base if you use a compatible endpoint. Without a key the app refuses email sign-in (passkeys
still work); calls go out through the egress proxy like every other outbound request.

Reverse proxy (Caddy, `/etc/caddy/Caddyfile`):

```
toolkien.example.com {
	reverse_proxy 127.0.0.1:3000
}
```

## First boot

```sh
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production exec openbao /openbao/scripts/init.sh
```

`init.sh` runs once. It prints the **unseal keys** (store them offline, split among people),
the app credentials (put them in `.env.production`) and the backup credentials (see Backups),
and revokes the root token. Then:

```sh
docker compose --env-file .env.production up -d app   # picks up the OpenBao credentials
```

Open `ORIGIN`, sign up, and you are in your personal workspace.

## After every restart: unseal

OpenBao starts sealed. Until three key holders unseal it, the app cannot read any credential:

```sh
docker compose --env-file .env.production exec openbao /openbao/scripts/unseal.sh
```

`docker compose ps` shows OpenBao as unhealthy while it is sealed: monitor that.

## Backups and restore

Two encrypted backups, kept apart (the database is useless without OpenBao, OpenBao without
the unseal keys). Scripts in `deploy/backup/`, run from the host's cron:

- `openbao-snapshot.sh`: raft snapshot via the backup AppRole, encrypted with `age`.
- `turso-export.sh`: daily SQL dump, gzip + `age` (set `SQLITE_FILE` for a local SQLite file).
- `restore-test.sh`: on the workstation holding the private key, restores a dump into a
  throwaway SQLite file and checks integrity, migrations and tables. Run it monthly.

Setup (env files in `/etc/toolkien`, cron lines) is in
[`deploy-coolify.md` → Backups](deploy-coolify.md#5-backups-host-cron); OpenBao restore steps
are in `deploy/openbao/README.md`. Copy backups off the server.

## Upgrades

```sh
git pull
docker compose --env-file .env.production up -d --build
docker compose --env-file .env.production exec openbao /openbao/scripts/unseal.sh  # if it restarted
```

Migrations run when the app starts (`SKIP_MIGRATIONS=1` to run them yourself with
`node deploy/app/migrate.mjs`). Run one app instance only: rate limits, caches and jobs live in
memory. Read the release notes before upgrades that touch OpenBao or the database.

## Security hardening checklist

- [ ] TLS at the reverse proxy; `ORIGIN` is `https://`; the app port is bound to loopback only.
- [ ] No other published ports (`docker compose ps`): OpenBao, egress proxy and runner have none.
- [ ] Unseal keys offline and split; root token revoked (`init.sh` does it); no standing admin token.
- [ ] `.env.production` mode 600, owned by root; secrets unique and random.
- [ ] Runner on the `sandbox` network only (`docker inspect`); gVisor enabled (`runtime: runsc`
      under `runner` in `docker-compose.yml`) when the host supports it.
- [ ] Never mount the Docker socket into any service.
- [ ] Host firewall: only 22, 80, 443 inbound; SSH keys only; unattended security updates.
- [ ] Swap off (or encrypted) so key material never hits disk.
- [ ] Both backups running, copied off-site, restore tested.
- [ ] Owners and admins of company workspaces register a passkey (enforced by the app).
- [ ] Transit key rotation left on (90 days); `rotate.sh trim` after each rotation.
- [ ] Container logs kept at most 14 days (compose rotates by size, 10 MB × 5; for an age limit
      use journald with `MaxRetentionSec=14day`, see `deploy-coolify.md` § 5b); the OpenBao
      audit log goes to stdout.
