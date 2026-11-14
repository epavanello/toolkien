#!/bin/sh
# Rotates the transit key that wraps workspace data keys. Zero downtime: old key versions keep
# decrypting until you raise min_decryption_version (step 3). Run INSIDE the container with an
# admin token (generate one with a quorum of unseal keys, see deploy/openbao/README.md):
#
#   docker exec -it -e BAO_TOKEN=<admin token> <openbao-container> /openbao/scripts/rotate.sh rotate
#   … wait for the app's daily `crypto.rewrap` job (or trigger it) …
#   docker exec -it -e BAO_TOKEN=<admin token> <openbao-container> /openbao/scripts/rotate.sh trim
set -eu
export BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"
TRANSIT_KEY="${TRANSIT_KEY:-toolkien-tokens}"
: "${BAO_TOKEN:?Set BAO_TOKEN to an admin token}"

latest() { bao read -field=latest_version "transit/keys/$TRANSIT_KEY"; }

case "${1:-}" in
rotate)
	bao write -f "transit/keys/$TRANSIT_KEY/rotate" >/dev/null
	echo "Rotated: latest version is now $(latest)."
	echo "New data keys are wrapped with it; the app's crypto.rewrap job re-wraps existing ones."
	echo "Check: select count(*) from workspace_data_key where wrapped_key not like 'vault:v$(latest):%';"
	echo "When that is 0, run: rotate.sh trim"
	;;
trim)
	version="$(latest)"
	bao write "transit/keys/$TRANSIT_KEY/config" min_decryption_version="$version" >/dev/null
	echo "min_decryption_version=$version: older key versions can no longer decrypt."
	;;
*)
	echo "usage: rotate.sh rotate|trim" >&2
	exit 2
	;;
esac
