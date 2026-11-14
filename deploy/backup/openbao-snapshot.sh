#!/bin/sh
# Encrypted OpenBao raft snapshot. Run on the HOST (cron), as root, e.g. daily at 03:10:
#
#   10 3 * * * /opt/toolkien/deploy/backup/openbao-snapshot.sh >> /var/log/toolkien-backup.log 2>&1
#
# Needs: docker, age (https://age-encryption.org). Reads /etc/toolkien/openbao-backup.env
# (mode 600) with:
#   BACKUP_ROLE_ID=…  BACKUP_SECRET_ID=…   (printed by init.sh, AppRole `toolkien-backup`)
#   AGE_RECIPIENT=age1…                     (public key; the private key stays OFFLINE)
#   OPENBAO_CONTAINER=…                     (optional; default: the container named *openbao*)
#   BACKUP_DIR=/var/backups/toolkien/openbao  RETENTION_DAYS=30
#
# The snapshot is already sealed by OpenBao's barrier (useless without the unseal keys) and is
# encrypted again with age. Keep these backups apart from the database backups, and copy them
# off the server (rclone/rsync to another provider).
set -eu
umask 077

CONFIG="${CONFIG:-/etc/toolkien/openbao-backup.env}"
# shellcheck disable=SC1090
. "$CONFIG"
: "${BACKUP_ROLE_ID:?}" "${BACKUP_SECRET_ID:?}" "${AGE_RECIPIENT:?}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/toolkien/openbao}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
container="${OPENBAO_CONTAINER:-$(docker ps --filter 'name=openbao' --format '{{.Names}}' | head -n 1)}"
[ -n "$container" ] || { echo "openbao container not found" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/openbao-$stamp.snap.age"

# secret_id goes through stdin, never on a command line
token="$(printf '%s' "$BACKUP_SECRET_ID" | docker exec -i "$container" \
	bao write -field=token auth/approle/login role_id="$BACKUP_ROLE_ID" secret_id=-)"
cleanup() {
	docker exec "$container" rm -f /tmp/toolkien.snap >/dev/null 2>&1 || true
	printf '%s' "$token" | docker exec -i "$container" sh -c 'BAO_TOKEN=$(cat) bao token revoke -self' \
		>/dev/null 2>&1 || true
}
trap cleanup EXIT

printf '%s' "$token" | docker exec -i "$container" \
	sh -c 'BAO_TOKEN=$(cat) bao operator raft snapshot save /tmp/toolkien.snap'
docker exec "$container" cat /tmp/toolkien.snap | age -r "$AGE_RECIPIENT" -o "$out.partial"
mv "$out.partial" "$out"
echo "$(date -u +%FT%TZ) openbao snapshot ok: $out ($(wc -c < "$out" | tr -d " ") bytes)"

find "$BACKUP_DIR" -name 'openbao-*.snap.age' -mtime +"$RETENTION_DAYS" -delete
