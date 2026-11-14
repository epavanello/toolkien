#!/bin/sh
# Unseals OpenBao after a restart. Run INSIDE the container, with key holders at hand:
#
#   docker exec -it <openbao-container> /openbao/scripts/unseal.sh
#
# Each key is typed at a hidden prompt (never on the command line or in shell history).
# Key holders can also run it one after the other: progress is kept by OpenBao.
set -eu
export BAO_ADDR="${BAO_ADDR:-http://127.0.0.1:8200}"

init_status=0
bao operator init -status >/dev/null 2>&1 || init_status=$?
if [ "$init_status" -eq 2 ]; then
	echo "OpenBao is not initialised yet: run init.sh first." >&2
	exit 1
elif [ "$init_status" -ne 0 ]; then
	echo "Cannot reach OpenBao at $BAO_ADDR." >&2
	exit 1
fi

sealed() {
	code=0
	bao status >/dev/null 2>&1 || code=$?
	[ "$code" -eq 2 ]
}

if ! sealed; then
	echo "OpenBao is already unsealed."
	exit 0
fi

while sealed; do
	progress="$(bao status 2>/dev/null | awk '/Unseal Progress/ { print $3 }')"
	echo "Sealed (progress ${progress:-0}). Enter an unseal key:"
	bao operator unseal >/dev/null || true
done
echo "OpenBao is unsealed."
