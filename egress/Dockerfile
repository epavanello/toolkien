# Toolkien egress proxy: HTTP CONNECT to public addresses on port 443 only.
# Build context: egress/   →   docker build -t toolkien-egress egress/
FROM denoland/deno:distroless-2.9.8

WORKDIR /app
COPY deno.json main.ts ./
COPY src ./src
# Type-check and cache at build time; nothing is downloaded at runtime
RUN ["deno", "cache", "main.ts"]

# Unprivileged (uid of the `deno` user in the official images)
USER 1993:1993
EXPOSE 3128
ENTRYPOINT ["deno", "run", "--no-prompt", "--cached-only", "--allow-net", "--allow-env=EGRESS_PROXY_TOKEN,EGRESS_ALLOW_ANONYMOUS,EGRESS_HOST,EGRESS_PORT,EGRESS_MAX_CONNECTIONS,EGRESS_HEADER_TIMEOUT_MS,EGRESS_CONNECT_TIMEOUT_MS,EGRESS_IDLE_TIMEOUT_MS,EGRESS_MAX_TUNNEL_MS", "main.ts"]
