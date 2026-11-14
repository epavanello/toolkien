# Infra notes (crypto, net, egress, deploy)

## Decisions

- **Envelope encryption** (`#lib/server/crypto`): one 32-byte DEK per workspace and version,
  generated in the app (WebCrypto), wrapped with OpenBao transit `encrypt` on the derived key
  `toolkien-tokens` (context = base64 workspace id). Values: AES-256-GCM, 12-byte nonce, workspace
  id as AAD. DEKs are imported non-extractable and the raw bytes zeroed; cache of 5 min (max
  1000 keys) with in-flight dedupe; concurrent first use converges on one DEK through the
  unique indexes of `workspace_data_key`.
- **We generate DEKs locally** instead of transit `datakey`: the `app` policy then needs only
  `encrypt`/`decrypt`/`rewrap`, as the spec says.
- **OpenBao client over plain fetch**: AppRole login, service token TTL 15 min / max 1 h,
  renewed at 2/3 of its life, fresh login past max TTL or after a 403. Errors carry operation +
  status only. App tokens have no `default` policy; `app` grants renew-self/lookup-self itself.
- **Rotation**: transit key auto-rotates every 90 days; the daily job `crypto.rewrap` (registered
  by `crypto/index.ts`) calls transit `rewrap` on every wrapped DEK (no-op until a rotation).
  `rewrap(ws, { rotateDataKey: true })` adds a DEK version and re-seals every sealed column of
  the workspace (`SEALED_GROUPS` in `crypto/store.ts`: **add new `sealed()` columns there**).
  `rewrapAllWorkspaces()` is exported for an admin action.
- **Dev fallback**: `TOOLKIEN_DEV_MASTER_KEY` (HKDF per workspace, `dev:v1:` prefix) only when
  `dev`; production throws at import without `OPENBAO_ADDR`, and the transit wrapper refuses
  `dev:` keys.
- **SSRF** (`#lib/server/net`): IPv4 blocklist (RFC 1918 incl. Docker pools, CGNAT, link-local
  and metadata, benchmarking, TEST-NETs, multicast, reserved); IPv6 **allowlist** (2000::/3 minus
  Teredo/6to4/documentation), so mapped/compatible/NAT64/ULA/link-local are blocked by
  construction. `localhost`, `*.local`, `*.internal`, `home.arpa` rejected before DNS. Only port
  443 (new reason `port`, additive). Direct mode pins DNS through a custom `lookup` on the undici
  Agent (the socket only gets an address we checked); proxy mode pre-checks in the app and the
  proxy re-resolves and dials the checked address. Redirects manual, re-checked per hop,
  credentials dropped cross-origin, 303/POST→GET. Bounded time and body size.
- **Egress proxy** (`egress/`, Deno): CONNECT only, 443 only, Basic proxy auth with
  `EGRESS_PROXY_TOKEN` (the `public` network may be shared with other containers on Coolify),
  same IP policy (`egress/src/ip.ts` is a byte copy of `src/lib/server/net/ip.ts`, a Deno test
  enforces it), connection cap, header/connect/idle/lifetime timeouts, logs reason codes only.
- **Compose**: one file for Coolify and plain compose. `core` is also `internal: true`
  (stricter than the spec table: OpenBao needs no internet). Coolify must use **Raw Compose
  Deployment**: in normal mode Coolify attaches its own network to every service, which would
  give the runner and OpenBao internet access. In raw mode `public` is the external `coolify`
  network (`PUBLIC_NETWORK*` vars) and routing comes from Traefik labels on the app.
- **OpenBao 2.7.2** (`deploy/openbao/`): raft, TLS off on the internal listener, declarative
  stdout audit device, 5/3 Shamir, root token revoked by `init.sh`, AppRoles `toolkien-app` and
  `toolkien-backup`. `disable_mlock` no longer exists in 2.7 (mlock removed): swap off on host.
  Smoke-tested: init, app client wrap/unwrap/rewrap, policy denials (keys read, rotate, export,
  sys), restart → sealed → unseal, backup AppRole snapshot.
- **App image**: Node 22 slim, pnpm pinned to 10.32.1 (corepack's default is now pnpm 12, whose
  `minimumReleaseAge` default rejects packages published < 1 day ago), full `node_modules`
  kept at runtime (libSQL native binding + drizzle migrator), non-root, read-only rootfs,
  `deploy/app/migrate.mjs` before `node build` (`SKIP_MIGRATIONS=1` to skip).

## For the integrator / other verticals

- **`.gitignore` excludes `/drizzle/` and `pnpm-lock.yaml`** (also `/static/`): the image build
  copies `drizzle/` and the deploy needs migrations and a locked install. Please un-ignore them.
- Add `"packageManager": "pnpm@10.32.1"` to `package.json` (then the Dockerfile `ARG` can go).
- README: link `docs/self-hosting.md` and `docs/deploy-coolify.md`; DECISIONS: the bullets above.
- `.dockerignore` at the root is new (infra).
- org-ops: an admin button could call `rewrapAllWorkspaces({ rotateDataKey })` and
  `clearKeyCache()` (kill switch).
- Runner hardening also assumes the runner agent's image is non-root (it is: `deno` user).
