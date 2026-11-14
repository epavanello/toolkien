#!/bin/sh
# Daily encrypted export of the Turso database (on top of Turso's point-in-time restore).
# Run on the HOST (cron), as root, e.g. daily at 03:30:
#
#   30 3 * * * /opt/toolkien/deploy/backup/turso-export.sh >> /var/log/toolkien-backup.log 2>&1
#
# Needs: turso CLI (authenticated with TURSO_API_TOKEN), age, gzip. Reads
# /etc/toolkien/turso-backup.env (mode 600):
#   TURSO_API_TOKEN=…        (`turso auth api-tokens mint toolkien-backup`)
#   TURSO_DATABASE=toolkien  (database name)
#   AGE_RECIPIENT=age1…      (public key; private key OFFLINE, different from the OpenBao one
#                             if you want the two backups held by different people)
#   BACKUP_DIR=/var/backups/toolkien/db  RETENTION_DAYS=30
#
# What is exported: everything in the database. Upstream tokens, script state and approval
# previews are only present sealed (envelope encryption): without OpenBao the dump exposes no
# credential. Self-hosting with a local SQLite file instead of Turso: set SQLITE_FILE=/path.db
# and the dump uses sqlite3 instead of the turso CLI.
set -eu
umask 077

CONFIG="${CONFIG:-/etc/toolkien/turso-backup.env}"
# shellcheck disable=SC1090
[ -f "$CONFIG" ] && . "$CONFIG"
: "${AGE_RECIPIENT:?}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/toolkien/db}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
export TURSO_API_TOKEN="${TURSO_API_TOKEN:-}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/toolkien-db-$stamp.sql.gz.age"

if [ -n "${SQLITE_FILE:-}" ]; then
	dump() { sqlite3 "$SQLITE_FILE" .dump; }
else
	: "${TURSO_DATABASE:?}"
	dump() { turso db shell "$TURSO_DATABASE" .dump; }
fi

dump | gzip -9 | age -r "$AGE_RECIPIENT" -o "$out.partial"
# An empty or truncated dump must not replace a good one silently
size="$(wc -c < "$out.partial" | tr -d " ")"
if [ "$size" -lt 1024 ]; then
	echo "$(date -u +%FT%TZ) db export FAILED: suspiciously small ($size bytes)" >&2
	rm -f "$out.partial"
	exit 1
fi
mv "$out.partial" "$out"
echo "$(date -u +%FT%TZ) db export ok: $out ($size bytes)"

find "$BACKUP_DIR" -name 'toolkien-db-*.sql.gz.age' -mtime +"$RETENTION_DAYS" -delete
