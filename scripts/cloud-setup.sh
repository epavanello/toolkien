#!/usr/bin/env bash
# Development environment bootstrap (Claude Code cloud sessions, fresh containers, new
# clones). Idempotent: safe to run on every session start.
#
#   bash scripts/cloud-setup.sh
#
# Installs dependencies (pnpm, Deno for the runner, Chromium for component tests), writes a
# dev `.env` with random secrets when missing, migrates and seeds `local.db`, caches the
# runner's Deno modules and generates the SvelteKit types.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.deno/bin:$PATH"

# ─── Node dependencies ────────────────────────────────────────────────────────
corepack enable >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

# ─── Deno (local runner: the app spawns `deno` when RUNNER_URL is empty) ──────
if ! command -v deno >/dev/null 2>&1; then
	# From $HOME: the installer leaves a deno.lock in the working directory
	(cd "$HOME" && curl -fsSL https://deno.land/install.sh | sh -s -- -y --no-modify-path)
fi
if [ -w /usr/local/bin ] && [ ! -e /usr/local/bin/deno ]; then
	ln -s "$HOME/.deno/bin/deno" /usr/local/bin/deno
fi
(cd runner && deno task cache) || echo "warn: deno cache for runner failed"

# ─── Chromium for the component tests (version pinned by the project's playwright) ───
pnpm exec playwright install chromium || echo "warn: playwright install failed (component tests)"

# ─── .env (development only, never committed) ────────────────────────────────
if [ ! -f .env ]; then
	cp .env.example .env
	sed -i \
		-e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$(openssl rand -base64 32)|" \
		-e "s|^TOOLKIEN_DEV_MASTER_KEY=.*|TOOLKIEN_DEV_MASTER_KEY=$(openssl rand -base64 32)|" \
		-e "s|^PLATFORM_ADMIN_EMAILS=.*|PLATFORM_ADMIN_EMAILS=alice@toolkien.test|" \
		.env
	echo "wrote .env (dev secrets generated)"
fi

# ─── Database: migrate + seed local.db ───────────────────────────────────────
pnpm db:migrate
pnpm db:seed

# ─── SvelteKit generated types ───────────────────────────────────────────────
pnpm exec svelte-kit sync
