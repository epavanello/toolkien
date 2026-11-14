# Toolkien runner: Deno supervisor + per-execution sandboxes. No network egress (internal
# `sandbox` network), no secrets besides RUNNER_SHARED_SECRET, nothing persistent.
# Run with: read_only rootfs, tmpfs /tmp, cap_drop ALL, no-new-privileges, pids/cpu/mem limits.
FROM denoland/deno:alpine-2.9.8

ENV DENO_DIR=/deno-dir \
	DENO_NO_UPDATE_CHECK=1 \
	NO_COLOR=1 \
	RUNNER_SCRATCH_DIR=/tmp \
	RUNNER_DENO_PATH=/bin/deno \
	RUNNER_PORT=8787 \
	RUNNER_DATA_LIMIT_MB=1024

WORKDIR /app
COPY deno.json deno.lock ./
COPY main.ts ./
COPY src ./src

# Everything the runner loads is cached at build time (checked against deno.lock); at runtime the
# checker uses --cached-only and the sandbox has no remote/npm resolution at all.
# (The checker's V8 code cache lives in /tmp at runtime, see `prepareCheckerCache`.)
RUN deno cache --frozen src/checker.ts main.ts \
	&& chmod -R a+rX,go-w /app /deno-dir

USER deno
EXPOSE 8787

# Supervisor permissions (trusted code). Read/write are unscoped only because Deno.symlink needs
# it (checker code cache); the read-only rootfs leaves /tmp as the only writable path. The
# sandboxes themselves run with no permission at all.
ENTRYPOINT ["deno", "run", "--no-prompt", "--cached-only", "--no-config", "--no-lock", \
	"--allow-net=0.0.0.0:8787", "--allow-env", "--allow-read", "--allow-write", \
	"--allow-run=/bin/deno,/bin/sh", "main.ts"]
