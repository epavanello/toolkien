# OpenBao for Toolkien

OpenBao holds the master key of the envelope encryption. The app never sees it: it asks the
transit engine to wrap and unwrap one data key (DEK) per workspace. The database only holds
wrapped DEKs and values sealed with them, so a stolen database exposes no credential.

| File                  | What                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| `openbao.hcl`         | Server config: raft storage on the volume, listener on `core` only, audit  |
| `policies/app.hcl`    | App policy: `encrypt`, `decrypt`, `rewrap` on `toolkien-tokens`, own token |
| `policies/backup.hcl` | Backup policy: raft snapshots only                                         |
| `init.sh`             | One-time init (Shamir keys, transit key, policies, AppRoles, root revoked) |
| `unseal.sh`           | Unseal after every restart (hidden prompts)                                |
| `rotate.sh`           | Transit key rotation (`rotate`, then `trim`)                               |

The scripts are baked into the image at `/openbao/scripts/`. Find the container with
`docker ps --filter name=openbao` (Coolify names it `openbao-<uuid>`, plain compose
`toolkien-openbao-1`).

## What `init.sh` sets up

- Shamir unseal keys (5 shares, threshold 3; `KEY_SHARES` / `KEY_THRESHOLD`), printed once.
- Transit engine with key `toolkien-tokens`: `aes256-gcm96`, **derived** (context = workspace
  id), not exportable, no plaintext backup, deletion disabled, automatic rotation every 90 days
  (`TRANSIT_AUTO_ROTATE`).
- Policy `app` and AppRole `toolkien-app`: service tokens, TTL 15 min, max 1 h, no `default`
  policy. The app renews its token at two thirds of its life and logs in again past the max
  TTL. Optional `APP_CIDRS` binds the secret id and tokens to the `core` subnet.
- Policy `backup` and AppRole `toolkien-backup` (5 min tokens) for snapshots.
- Audit device `file` to stdout (declared in `openbao.hcl`), sensitive values HMAC-hashed.
- The initial root token is revoked.

## Admin token when you need one

There is no standing root token. For maintenance (rotation, policy changes), generate one
with a quorum of unseal key holders and revoke it right after:

```sh
docker exec -it <openbao> sh
bao operator generate-root -init          # prints a nonce and an OTP: keep the OTP
bao operator generate-root                # each key holder, until "Complete: true"
bao operator generate-root -decode=<encoded token> -otp=<OTP>
# … work with BAO_TOKEN=<token> …
bao token revoke -self
```

## Key rotation without downtime

Two layers rotate independently.

**Transit key (master)**. Automatic every 90 days, or by hand:

1. `docker exec -it -e BAO_TOKEN=<admin> <openbao> /openbao/scripts/rotate.sh rotate`. New
   DEKs are wrapped with the new version at once; old versions still decrypt.
2. The app job `crypto.rewrap` (daily) calls transit `rewrap` on every wrapped DEK: the DEK
   never leaves OpenBao in clear, values sealed with it are untouched. Platform admins can
   also call `rewrapAllWorkspaces()` (`#lib/server/crypto`) to do it now.
3. Check that nothing is left on old versions:
   `select count(*) from workspace_data_key where wrapped_key not like 'vault:v<latest>:%';`
4. When it is 0: `rotate.sh trim` sets `min_decryption_version`, so a leaked old key version
   is useless.

**Workspace data keys**. `rewrap(workspaceId, { rotateDataKey: true })` creates a new active
DEK version, retires the old one (still readable) and re-seals every sealed column of the
workspace in the background (optimistic per row, safe to re-run). Use it after an incident
involving one workspace. Retired DEK rows can be deleted once no value references them.

## Backups

`deploy/backup/openbao-snapshot.sh` (host cron) logs in with the backup AppRole, saves a raft
snapshot and encrypts it with `age` to a public key whose private half is offline. Keep these
apart from the database exports: one without the other is useless, and that is the point.

Restore (new server): start an empty OpenBao, initialise it with a throwaway key, then restore
the snapshot over it. After the restore it is sealed with the ORIGINAL unseal keys.

```sh
age -d -i openbao.key openbao-<stamp>.snap.age > openbao.snap
docker compose up -d openbao
docker exec -it <openbao> bao operator init -key-shares=1 -key-threshold=1   # temporary
docker exec -it <openbao> bao operator unseal <temporary key>
docker cp openbao.snap <openbao>:/tmp/openbao.snap
docker exec -it -e BAO_TOKEN=<temporary root token> <openbao> \
  bao operator raft snapshot restore -force /tmp/openbao.snap
docker restart <openbao>
docker exec -it <openbao> /openbao/scripts/unseal.sh                         # original keys
shred -u openbao.snap
```

The app credentials (`OPENBAO_ROLE_ID` / `OPENBAO_SECRET_ID`) come back with the snapshot.

## Auto-unseal (later)

Manual unseal is the first version: a restart means sealed until key holders act, and the app
returns errors for anything touching credentials meanwhile. Auto-unseal through an external
KMS (`seal "awskms"`, `"gcpckms"`, `"transit"` on another OpenBao) trades that for trusting the
KMS; evaluate once uptime matters more than independence from a cloud provider.
