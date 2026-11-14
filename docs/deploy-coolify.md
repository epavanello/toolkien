# Deploy on Coolify

Toolkien runs as **two Docker Compose resources** on a Coolify server in the EU:

- **toolkien-vault** (`deploy/openbao/compose.yml`): OpenBao alone. Deployed once, auto-deploy
  off. Coolify recreates every container of a resource on each deploy, and OpenBao comes back
  sealed: keeping it apart means pushes to `main` never seal it.
- **toolkien** (`docker-compose.yml`): app, egress proxy, runner. Auto-deploy on push.

Only the app gets a domain. Turso (EU region) is the database, outside the VPS. For a plain
`docker compose` install see [`self-hosting.md`](self-hosting.md); the compose files are the same.

| Service      | Resource       | Networks                             | Volume     | Exposed     |
| ------------ | -------------- | ------------------------------------ | ---------- | ----------- |
| app          | toolkien       | `public`, `core`, `sandbox`, `vault` | no         | yes, domain |
| egress-proxy | toolkien       | `core`, `public`                     | no         | no          |
| runner       | toolkien       | `sandbox` (internal)                 | no         | no          |
| openbao      | toolkien-vault | `vault` (internal)                   | yes (raft) | no          |

## Why "Raw Compose Deployment"

In its normal mode Coolify attaches its own per-resource network to **every** service. That
network has internet access, so the runner (untrusted code) and OpenBao would get a route out,
breaking the isolation the table above relies on. In **raw mode** Coolify deploys the file as
written: our networks only, plus the Traefik labels on the app. Keep raw mode on.

## 1. Prepare

- A VPS in the EU with Coolify v4 (proxy: Traefik, the default), 4 GB RAM minimum, swap off
  (OpenBao keeps keys in memory).
- Optional, recommended: [gVisor](https://gvisor.dev/docs/user_guide/install/) installed on the
  host as the `runsc` runtime (`/etc/docker/daemon.json`), for the runner.
- A Turso database in an EU region: `turso db create toolkien --location fra`, then
  `turso db show --url toolkien` and `turso db tokens create toolkien`.
- A DNS record for the app domain pointing at the server.
- Secrets, each generated separately:
  ```sh
  openssl rand -base64 32   # BETTER_AUTH_SECRET
  openssl rand -hex 32      # RUNNER_SHARED_SECRET
  openssl rand -hex 32      # EGRESS_PROXY_TOKEN
  ```

## 2. Create the OpenBao resource (once)

1. **Project → New resource → Public/Private repository**, branch `main`.
2. **Build pack: Docker Compose**, base directory `/deploy/openbao`, compose file `/compose.yml`.
3. **Advanced → Raw Compose Deployment: ON**; **auto-deploy: OFF** (General / Advanced).
4. No environment variables, no domain. **Deploy.** It creates the internal `toolkien_vault`
   network and starts OpenBao **uninitialised and sealed**.
5. Initialise it now (step 4 below), keep the app credentials for the next step.

## 3. Create the app resource

1. **Project → New resource → Public/Private repository**, branch `main`.
2. **Build pack: Docker Compose**, compose file `/docker-compose.yml`.
3. **Advanced → Raw Compose Deployment: ON.**
4. **Environment variables** (mark secrets as such; see `deploy/compose.env.example`):

   | Variable                  | Value                                     |
   | ------------------------- | ----------------------------------------- |
   | `ORIGIN`                  | `https://toolkien.example.com`            |
   | `APP_DOMAIN`              | `toolkien.example.com`                    |
   | `PUBLIC_NETWORK`          | `coolify`                                 |
   | `PUBLIC_NETWORK_EXTERNAL` | `true`                                    |
   | `TRAEFIK_CERT_RESOLVER`   | `letsencrypt`                             |
   | `APP_PUBLISH`             | `127.0.0.1:3000` (any free loopback port) |
   | `DATABASE_URL`            | `libsql://toolkien-<org>.turso.io`        |
   | `DATABASE_AUTH_TOKEN`     | Turso token                               |
   | `BETTER_AUTH_SECRET`      | generated                                 |
   | `RUNNER_SHARED_SECRET`    | generated                                 |
   | `EGRESS_PROXY_TOKEN`      | generated                                 |
   | `PLATFORM_ADMIN_EMAILS`   | your email                                |
   | `OPENBAO_ROLE_ID`         | printed by `init.sh`                      |
   | `OPENBAO_SECRET_ID`       | printed by `init.sh`                      |

   `PUBLIC_NETWORK=coolify` puts the app and the egress proxy on the network Coolify's Traefik
   uses; check its name with `docker network ls` (it is `coolify` on a standard install).

5. Leave the domain fields of the services empty: routing comes from the Traefik labels.
6. If gVisor is installed, uncomment `runtime: runsc` under `runner` in your fork, or keep a
   small compose override in the repo you deploy.
7. **Deploy.** The app starts, runs migrations and joins `toolkien_vault`. Deploy the OpenBao
   resource first: the app's deploy fails while that network does not exist.

## 4. Initialise OpenBao (once)

From **Terminal** in Coolify, pick the OpenBao container (or SSH on the server):

```sh
/openbao/scripts/init.sh
# a single operator can choose one key instead of 3 of 5:
KEY_SHARES=1 KEY_THRESHOLD=1 /openbao/scripts/init.sh
```

It prints, once: the unseal keys, the app AppRole credentials and the backup AppRole
credentials, then revokes the root token.

- Unseal keys: offline, ideally one per person (password managers of different people, paper
  in a safe). Never on the server, in Coolify, in the repo or in a chat.
- `OPENBAO_ROLE_ID` / `OPENBAO_SECRET_ID`: set them in the app resource's environment variables
  (and redeploy it if it already runs).
- Backup credentials: see step 5.

Clear the terminal scrollback afterwards. Details: `deploy/openbao/README.md`.

## 4b. After a restart of OpenBao: unseal

OpenBao is sealed whenever its container restarts: server reboot, a redeploy of the
toolkien-vault resource, sometimes a Coolify update. App deploys do not touch it. Its health
check stays unhealthy until unsealed, and the app cannot read credentials meanwhile.

```sh
/openbao/scripts/unseal.sh     # Coolify Terminal, OpenBao container
```

Key holders type their key at a hidden prompt (they can do it one after the other). Set a
Coolify notification on unhealthy containers so a sealed OpenBao does not go unnoticed.

## 5. Backups (host cron)

Two independent, encrypted backups, kept apart: the database is useless without OpenBao and
OpenBao is useless without the unseal keys. Install `age` and the `turso` CLI on the host,
clone the repo to `/opt/toolkien` (scripts only), and create two `age` key pairs on a
workstation (`age-keygen -o toolkien-db.key`, `age-keygen -o toolkien-bao.key`): only the
public keys go on the server.

```sh
install -d -m 700 /etc/toolkien
cat > /etc/toolkien/openbao-backup.env <<'EOF'
BACKUP_ROLE_ID=…
BACKUP_SECRET_ID=…
AGE_RECIPIENT=age1…   # public key of toolkien-bao.key
EOF
cat > /etc/toolkien/turso-backup.env <<'EOF'
TURSO_API_TOKEN=…     # turso auth api-tokens mint toolkien-backup
TURSO_DATABASE=toolkien
AGE_RECIPIENT=age1…   # public key of toolkien-db.key
EOF
chmod 600 /etc/toolkien/*.env
crontab -e
# 10 3 * * * /opt/toolkien/deploy/backup/openbao-snapshot.sh >> /var/log/toolkien-backup.log 2>&1
# 30 3 * * * /opt/toolkien/deploy/backup/turso-export.sh    >> /var/log/toolkien-backup.log 2>&1
```

Copy `/var/backups/toolkien` off the server (rclone/restic to another provider). Turso's own
point-in-time restore covers recent mistakes; the daily export covers losing the Turso account.

**Restore test** (monthly and after schema changes), on the workstation holding the private key:

```sh
scp server:/var/backups/toolkien/db/toolkien-db-<stamp>.sql.gz.age .
deploy/backup/restore-test.sh toolkien-db-<stamp>.sql.gz.age ~/keys/toolkien-db.key
```

## 5b. Technical logs (14 days)

Container stdout/stderr are the technical logs: ids and reason codes, no personal data beyond
ids, no content. The retention promise is **14 days**. Docker's `json-file` driver (set in
`docker-compose.yml`, 10 MB × 5 per container) rotates by size only, so on a busy instance logs
may go sooner and on a quiet one they may stay longer. To enforce the age limit, send container
logs to journald and cap journald's age on the host:

```sh
# /etc/docker/daemon.json → {"log-driver": "journald"}   (and drop `logging:` from the compose file)
# /etc/systemd/journald.conf → MaxRetentionSec=14day
systemctl restart systemd-journald docker
```

Or keep `json-file` and add a daily host cron that deletes rotated files older than 14 days. Any
log shipping (Coolify, Loki…) must apply the same 14-day retention.

## 6. Verify

- `https://<domain>` loads; sign up; your personal workspace opens.
- `docker inspect <runner-container> --format '{{json .NetworkSettings.Networks}}'` lists only
  the `sandbox` network; same check for OpenBao (`toolkien_vault` only).
- From the runner, nothing outside resolves or connects:
  `docker exec <runner-container> deno eval "await fetch('https://example.com')"` fails.
- Add a connector to a public MCP server: the call goes out through the egress proxy.

## Updates

Push to `main` and redeploy (or enable auto-deploy) the **app** resource. The app runs
migrations on start; Toolkien assumes **one app instance**, so keep Coolify's rolling updates off
for it. Redeploy the OpenBao resource only when its release notes say so, then unseal. Changing OpenBao or Deno versions: bump the
`FROM` lines in `deploy/openbao/Dockerfile`, `egress/Dockerfile`, `runner/Dockerfile`.

## Key rotation

The transit key rotates automatically every 90 days and the app re-wraps data keys daily. The
manual procedure and the final `min_decryption_version` step are in
`deploy/openbao/README.md`.
