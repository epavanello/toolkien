#!/bin/sh
# Restore test for a database export. Run on a WORKSTATION that holds the age private key
# (never on the server), at least monthly and after every schema change:
#
#   deploy/backup/restore-test.sh toolkien-db-<stamp>.sql.gz.age ~/.age/toolkien-db.key
#
# Needs: age, gzip, sqlite3. Restores into a throwaway SQLite file, then checks integrity,
# the migration journal and that the main tables are readable. Exit code 0 = restorable.
set -eu
umask 077

backup="${1:?usage: restore-test.sh <backup.sql.gz.age> <age identity file>}"
identity="${2:?usage: restore-test.sh <backup.sql.gz.age> <age identity file>}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
db="$work/restore.db"

age -d -i "$identity" "$backup" | gunzip | sqlite3 "$db"

fail() { echo "RESTORE TEST FAILED: $*" >&2; exit 1; }
[ "$(sqlite3 "$db" 'pragma integrity_check;')" = "ok" ] || fail "integrity_check"
[ "$(sqlite3 "$db" 'pragma foreign_key_check;' | wc -l)" -eq 0 ] || fail "foreign_key_check"

migrations="$(sqlite3 "$db" 'select count(*) from __drizzle_migrations;' 2>/dev/null || echo 0)"
expected="$(ls "$(dirname "$0")/../../drizzle"/*.sql 2>/dev/null | wc -l | tr -d ' ')"
echo "migrations applied: $migrations (repo has $expected)"
[ "$migrations" -gt 0 ] || fail "no migration journal"

for table in user organization member workspace_data_key connector connector_credential audit_event; do
	count="$(sqlite3 "$db" "select count(*) from $table;" 2>/dev/null)" || fail "table $table unreadable"
	echo "$table: $count rows"
done

# Sealed values must still be sealed (no plaintext column ever appears in a dump)
keys="$(sqlite3 "$db" "select count(*) from workspace_data_key where wrapped_key not like 'vault:%';")"
[ "$keys" -eq 0 ] || echo "warning: $keys data keys not wrapped by OpenBao (dev keys in production?)"

echo "RESTORE TEST OK ($(du -h "$db" | cut -f1) restored)"
echo "Full restore: turso db create toolkien-restored --from-dump <decompressed .sql>, then point"
echo "DATABASE_URL at it (OpenBao must be the same instance, or restored from its snapshot)."
