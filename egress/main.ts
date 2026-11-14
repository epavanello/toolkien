/**
 * Toolkien egress proxy. The only way out to upstream MCP servers and OAuth endpoints.
 *
 *   EGRESS_PROXY_TOKEN=… deno task start
 */
import { startProxy } from './src/proxy.ts';

const env = (name: string) => Deno.env.get(name)?.trim() || undefined;
const int = (name: string, fallback: number) => {
	const raw = env(name);
	if (!raw) return fallback;
	const value = Number(raw);
	if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
	return value;
};

const token = env('EGRESS_PROXY_TOKEN');
if (!token && env('EGRESS_ALLOW_ANONYMOUS') !== 'true') {
	console.error(
		JSON.stringify({
			event: 'startup.failed',
			error: 'EGRESS_PROXY_TOKEN is required (set EGRESS_ALLOW_ANONYMOUS=true only for local tests)'
		})
	);
	Deno.exit(1);
}

const proxy = startProxy({
	hostname: env('EGRESS_HOST') ?? '0.0.0.0',
	port: int('EGRESS_PORT', 3128),
	token,
	maxConnections: int('EGRESS_MAX_CONNECTIONS', 256),
	headerTimeoutMs: int('EGRESS_HEADER_TIMEOUT_MS', 10_000),
	connectTimeoutMs: int('EGRESS_CONNECT_TIMEOUT_MS', 10_000),
	idleTimeoutMs: int('EGRESS_IDLE_TIMEOUT_MS', 120_000),
	maxTunnelMs: int('EGRESS_MAX_TUNNEL_MS', 15 * 60_000)
});
console.log(JSON.stringify({ event: 'listening', port: proxy.port }));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	try {
		Deno.addSignalListener(signal, () => void proxy.close().then(() => Deno.exit(0)));
	} catch {
		// signals unsupported on this platform
	}
}
