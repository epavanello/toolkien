# Toolkien app (SvelteKit, adapter-node). Migrations run at start, then the server.
#   docker build -t toolkien-app .

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Same pnpm major as development (package.json has no `packageManager` field yet)
ARG PNPM_VERSION=10.32.1
ENV CI=true PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare "pnpm@${PNPM_VERSION}" --activate
COPY package.json pnpm-lock.yaml* pnpm-workspace.yaml ./
# Locked install when the lockfile is committed (it should be: pinned, verified dependencies)
RUN if [ -f pnpm-lock.yaml ]; then pnpm install --frozen-lockfile; else pnpm install; fi
COPY . .
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
# adapter-node output, migrations and the migrate script; node_modules keeps the libSQL driver
# (native binding) and drizzle's migrator available at runtime
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/build ./build
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/deploy/app/migrate.mjs ./deploy/app/migrate.mjs
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
	CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then((r) => process.exit(r.status < 500 ? 0 : 1), () => process.exit(1))"]
# `SKIP_MIGRATIONS=1` starts without migrating (e.g. when migrations run as a separate step)
CMD ["sh", "-c", "[ \"$SKIP_MIGRATIONS\" = 1 ] || node deploy/app/migrate.mjs && exec node build"]
