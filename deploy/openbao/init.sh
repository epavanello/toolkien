#!/bin/sh
# One-time OpenBao initialisation for Toolkien. Run INSIDE the openbao container, once:
#
#   docker exec -it <openbao-container> /openbao/scripts/init.sh
#
# It prints the Shamir unseal keys and the AppRole credentials ONCE. Copy the unseal keys to
# offline storage (password manager vaults of different people, paper in a safe), never to the
# server, the repo or a chat. The root token is used for setup and revoked at the end.
#
# Env: KEY_SHARES (5), KEY_THRESHOLD (3), TRANSIT_KEY (toolkien-tokens),
#      TRANSIT_AUTO_ROTATE (2160h = 90 days, "0" disables), APP_TOKEN_TTL (15m),
#      APP_TOKEN_MAX_TTL (1h), APP_CIDRS (optional, comma-separated CIDRs allowed to use the
#      app secret_id, e.g. the `core` network subnet)
set -eu

export BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
KEY_SHARES="${KEY_SHARES:-5}"
KEY_THRESHOLD="${KEY_THRESHOLD:-3}"
TRANSIT_KEY="${TRANSIT_KEY:-toolkien-tokens}"
TRANSIT_AUTO_ROTATE="${TRANSIT_AUTO_ROTATE:-2160h}"
APP_TOKEN_TTL="${APP_TOKEN_TTL:-15m}"
APP_TOKEN_MAX_TTL="${APP_TOKEN_MAX_TTL:-1h}"

# Never write secrets to the container filesystem or shell history
umask 077
unset HISTFILE

status=0
bao operator init -status >/dev/null 2>&1 || status=$?
if [ "$status" -eq 0 ]; then
	echo "OpenBao is already initialised: nothing to do (use unseal.sh after a restart)." >&2
	exit 1
elif [ "$status" -ne 2 ]; then
	echo "Cannot reach OpenBao at $BAO_ADDR (is the server running?)." >&2
	exit 1
fi

init_out="$(bao operator init -key-shares="$KEY_SHARES" -key-threshold="$KEY_THRESHOLD")"
unseal_keys="$(printf '%s\n' "$init_out" | sed -n 's/^Unseal Key [0-9]*: //p')"
root_token="$(printf '%s\n' "$init_out" | sed -n 's/^Initial Root Token: //p')"
if [ -z "$unseal_keys" ] || [ -z "$root_token" ]; then
	echo "Could not parse the init output; run 'bao operator init' by hand." >&2
	exit 1
fi

echo "Unsealing with $KEY_THRESHOLD of $KEY_SHARES keys…" >&2
printf '%s\n' "$unseal_keys" | head -n "$KEY_THRESHOLD" | while read -r key; do
	bao operator unseal "$key" >/dev/null
done

export BAO_TOKEN="$root_token"
# Raft elects itself leader shortly after unseal
i=0
until bao token lookup >/dev/null 2>&1; do
	i=$((i + 1))
	[ "$i" -gt 30 ] && { echo "OpenBao did not become active." >&2; exit 1; }
	sleep 1
done

# Audit: the device is declared in openbao.hcl; make sure one is active before anything else
if ! bao audit list 2>/dev/null | grep -q .; then
	bao audit enable file file_path=stdout >/dev/null
fi

bao secrets enable transit >/dev/null
# Derived key: the workspace id is the derivation context, each workspace gets its own key
bao write -f "transit/keys/$TRANSIT_KEY" type=aes256-gcm96 derived=true exportable=false \
	allow_plaintext_backup=false >/dev/null
if [ "$TRANSIT_AUTO_ROTATE" != "0" ]; then
	bao write "transit/keys/$TRANSIT_KEY/config" auto_rotate_period="$TRANSIT_AUTO_ROTATE" \
		deletion_allowed=false >/dev/null
fi

sed "s/toolkien-tokens/$TRANSIT_KEY/g" /openbao/policies/app.hcl | bao policy write app - >/dev/null
bao policy write backup /openbao/policies/backup.hcl >/dev/null

bao auth enable approle >/dev/null
cidr_args=""
if [ -n "${APP_CIDRS:-}" ]; then
	cidr_args="secret_id_bound_cidrs=$APP_CIDRS token_bound_cidrs=$APP_CIDRS"
fi
# shellcheck disable=SC2086
bao write auth/approle/role/toolkien-app \
	token_policies=app token_no_default_policy=true token_type=service \
	token_ttl="$APP_TOKEN_TTL" token_max_ttl="$APP_TOKEN_MAX_TTL" \
	secret_id_ttl=0 secret_id_num_uses=0 $cidr_args >/dev/null
bao write auth/approle/role/toolkien-backup \
	token_policies=backup token_no_default_policy=true token_type=service \
	token_ttl=5m token_max_ttl=10m secret_id_ttl=0 secret_id_num_uses=0 >/dev/null

app_role_id="$(bao read -field=role_id auth/approle/role/toolkien-app/role-id)"
app_secret_id="$(bao write -f -field=secret_id auth/approle/role/toolkien-app/secret-id)"
backup_role_id="$(bao read -field=role_id auth/approle/role/toolkien-backup/role-id)"
backup_secret_id="$(bao write -f -field=secret_id auth/approle/role/toolkien-backup/secret-id)"

# Setup done: the root token goes away. A new one needs a quorum of unseal keys
# (`bao operator generate-root`), see deploy/openbao/README.md.
bao token revoke -self >/dev/null
unset BAO_TOKEN root_token

cat <<OUT

================================================================================
 OpenBao initialised. This is the ONLY time these values are shown.
================================================================================

 1. UNSEAL KEYS ($KEY_THRESHOLD of $KEY_SHARES needed after every restart).
    Store each one OFFLINE, ideally with a different person. Never on this server.

$(printf '%s\n' "$unseal_keys" | awk '{ printf "    Unseal key %d: %s\n", NR, $0 }')

 2. APP credentials -> set in Coolify / your .env, then redeploy the app:

    OPENBAO_ROLE_ID=$app_role_id
    OPENBAO_SECRET_ID=$app_secret_id

 3. BACKUP credentials -> root-only file on the host used by
    deploy/backup/openbao-snapshot.sh (e.g. /etc/toolkien/openbao-backup.env, mode 600):

    BACKUP_ROLE_ID=$backup_role_id
    BACKUP_SECRET_ID=$backup_secret_id

 The initial root token has been revoked.
 Clear this terminal's scrollback once the values are stored.
================================================================================
OUT
