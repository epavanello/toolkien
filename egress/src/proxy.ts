/**
 * Egress forward proxy: HTTP CONNECT only, port 443 only, to public addresses only. The app's
 * `safeFetch` already checks destinations; this is the enforcement point (defense in depth):
 * the proxy resolves the name itself, checks every address and dials the checked address, so
 * DNS rebinding between the app's check and the connection gains nothing.
 *
 * TLS is end to end through the tunnel: the proxy never sees payloads and logs none.
 */
import { isIP } from 'node:net';
import { isAllowedAddress } from './ip.ts';

export type Resolver = (hostname: string) => Promise<string[]>;
export type Dialer = (address: string, port: number) => Promise<Deno.Conn>;

export type ProxyOptions = {
	hostname?: string;
	port?: number;
	/** Required `Proxy-Authorization: Basic base64(any:<token>)` when set */
	token?: string;
	allowedPorts?: number[];
	maxConnections?: number;
	/** Time allowed to send the CONNECT request head */
	headerTimeoutMs?: number;
	connectTimeoutMs?: number;
	/** A tunnel with no traffic in either direction for this long is closed */
	idleTimeoutMs?: number;
	/** Hard cap on a tunnel's lifetime */
	maxTunnelMs?: number;
	resolve?: Resolver;
	dial?: Dialer;
	/** Content-free event sink (reason codes only); defaults to JSON lines on stdout */
	log?: (event: string, fields?: Record<string, string | number>) => void;
};

export type Denial =
	| 'method'
	| 'auth'
	| 'bad_request'
	| 'port'
	| 'blocked_address'
	| 'dns_failure'
	| 'busy'
	| 'upstream_unreachable'
	| 'upstream_timeout';

const STATUS: Record<Denial, string> = {
	method: '405 Method Not Allowed',
	auth: '407 Proxy Authentication Required',
	bad_request: '400 Bad Request',
	port: '403 Forbidden',
	blocked_address: '403 Forbidden',
	dns_failure: '502 Bad Gateway',
	busy: '503 Service Unavailable',
	upstream_unreachable: '502 Bad Gateway',
	upstream_timeout: '504 Gateway Timeout'
};

const MAX_HEAD_BYTES = 8 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Denied extends Error {
	constructor(readonly reason: Denial) {
		super(reason);
	}
}

export const systemResolver: Resolver = async (hostname) => {
	const results = await Promise.allSettled([
		Deno.resolveDns(hostname, 'A'),
		Deno.resolveDns(hostname, 'AAAA')
	]);
	return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
};

export const systemDialer: Dialer = (address, port) =>
	Deno.connect({ hostname: address, port, transport: 'tcp' });

/** Constant-time string comparison */
function safeEqual(a: string, b: string) {
	const x = encoder.encode(a);
	const y = encoder.encode(b);
	let diff = x.length ^ y.length;
	for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
	return diff === 0;
}

function checkAuth(header: string | undefined, token: string | undefined) {
	if (!token) return;
	const match = header?.match(/^Basic\s+([A-Za-z0-9+/=]+)$/i);
	if (!match) throw new Denied('auth');
	let decoded: string;
	try {
		decoded = atob(match[1]!);
	} catch {
		throw new Denied('auth');
	}
	const password = decoded.slice(decoded.indexOf(':') + 1);
	if (!safeEqual(password, token)) throw new Denied('auth');
}

const LOCAL_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa'];
const HOSTNAME =
	/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** `host:port` or `[v6]:port` → parts, rejecting anything odd */
export function parseTarget(target: string): { host: string; port: number } {
	const match = target.match(/^(?:\[([0-9a-fA-F:.]+)\]|([^:\s[\]]+)):(\d{1,5})$/);
	if (!match) throw new Denied('bad_request');
	const host = (match[1] ?? match[2]!).toLowerCase().replace(/\.$/, '');
	const port = Number(match[3]);
	if (port < 1 || port > 65535) throw new Denied('bad_request');
	if (match[1] && isIP(host) !== 6) throw new Denied('bad_request');
	if (!match[1] && isIP(host) === 0 && !HOSTNAME.test(host)) {
		// Single-label names (Docker service names like `openbao`) are never public
		throw new Denied(/^[a-z0-9-]+$/.test(host) ? 'blocked_address' : 'bad_request');
	}
	return { host, port };
}

/** Every address must be public; returns them in resolver order */
export async function resolveTarget(host: string, resolve: Resolver): Promise<string[]> {
	if (isIP(host) !== 0) {
		if (!isAllowedAddress(host)) throw new Denied('blocked_address');
		return [host];
	}
	if (LOCAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
		throw new Denied('blocked_address');
	}
	let addresses: string[];
	try {
		addresses = await resolve(host);
	} catch {
		throw new Denied('dns_failure');
	}
	if (addresses.length === 0) throw new Denied('dns_failure');
	if (addresses.some((a) => !isAllowedAddress(a))) throw new Denied('blocked_address');
	return addresses;
}

type Head = { method: string; target: string; headers: Map<string, string>; rest: Uint8Array };

/** Reads the request head (bounded size and time); `rest` is what the client sent after it */
async function readHead(conn: Deno.Conn, timeoutMs: number): Promise<Head> {
	const buffer = new Uint8Array(MAX_HEAD_BYTES);
	let length = 0;
	const timer = setTimeout(() => conn.close(), timeoutMs);
	try {
		while (length < MAX_HEAD_BYTES) {
			const n = await conn.read(buffer.subarray(length));
			if (n === null) throw new Denied('bad_request');
			length += n;
			const text = decoder.decode(buffer.subarray(0, length));
			const end = text.indexOf('\r\n\r\n');
			if (end === -1) continue;
			const [requestLine, ...lines] = text.slice(0, end).split('\r\n');
			const [method, target, version] = requestLine!.split(' ');
			if (!method || !target || !/^HTTP\/1\.[01]$/.test(version ?? '')) {
				throw new Denied('bad_request');
			}
			const headers = new Map<string, string>();
			for (const line of lines) {
				const colon = line.indexOf(':');
				if (colon > 0) {
					headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
				}
			}
			const headBytes = encoder.encode(text.slice(0, end + 4)).byteLength;
			return { method, target, headers, rest: buffer.slice(headBytes, length) };
		}
		throw new Denied('bad_request');
	} catch (error) {
		if (error instanceof Denied) throw error;
		throw new Denied('bad_request');
	} finally {
		clearTimeout(timer);
	}
}

async function dialFirst(
	addresses: string[],
	port: number,
	dial: Dialer,
	timeoutMs: number
): Promise<Deno.Conn> {
	let timedOut = false;
	for (const address of addresses) {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				dial(address, port),
				new Promise<never>((_, reject) => {
					timer = setTimeout(() => {
						timedOut = true;
						reject(new Error('timeout'));
					}, timeoutMs);
				})
			]);
		} catch {
			// try the next address
		} finally {
			clearTimeout(timer);
		}
	}
	throw new Denied(timedOut ? 'upstream_timeout' : 'upstream_unreachable');
}

async function writeAll(conn: Deno.Conn, data: Uint8Array) {
	let offset = 0;
	while (offset < data.length) offset += await conn.write(data.subarray(offset));
}

/** Bidirectional copy with idle and lifetime limits; resolves when either side closes */
async function tunnel(client: Deno.Conn, upstream: Deno.Conn, idleMs: number, maxMs: number) {
	let last = Date.now();
	const started = last;
	const done = new AbortController();
	const watchdog = setInterval(
		() => {
			const now = Date.now();
			if (now - last > idleMs || now - started > maxMs) done.abort();
		},
		Math.min(1000, idleMs)
	);
	const touch = () =>
		new TransformStream<Uint8Array, Uint8Array>({
			transform(chunk, controller) {
				last = Date.now();
				controller.enqueue(chunk);
			}
		});
	const pipe = (from: Deno.Conn, to: Deno.Conn) =>
		from.readable
			.pipeThrough(touch())
			.pipeTo(to.writable, { signal: done.signal, preventClose: false })
			.catch(() => {})
			.finally(() => done.abort());
	try {
		await Promise.race([
			Promise.all([pipe(client, upstream), pipe(upstream, client)]),
			new Promise((resolve) => done.signal.addEventListener('abort', resolve))
		]);
	} finally {
		clearInterval(watchdog);
		for (const conn of [client, upstream]) {
			try {
				conn.close();
			} catch {
				// already closed
			}
		}
	}
}

export type ProxyServer = {
	port: number;
	/** Open tunnels right now */
	active: () => number;
	close: () => Promise<void>;
};

export function startProxy(options: ProxyOptions = {}): ProxyServer {
	const config = {
		allowedPorts: options.allowedPorts ?? [443],
		maxConnections: options.maxConnections ?? 256,
		headerTimeoutMs: options.headerTimeoutMs ?? 10_000,
		connectTimeoutMs: options.connectTimeoutMs ?? 10_000,
		idleTimeoutMs: options.idleTimeoutMs ?? 120_000,
		maxTunnelMs: options.maxTunnelMs ?? 15 * 60_000,
		resolve: options.resolve ?? systemResolver,
		dial: options.dial ?? systemDialer,
		log:
			options.log ??
			((event: string, fields: Record<string, string | number> = {}) =>
				console.log(JSON.stringify({ event, ...fields })))
	};
	const listener = Deno.listen({
		hostname: options.hostname ?? '0.0.0.0',
		port: options.port ?? 3128,
		transport: 'tcp'
	});
	const open = new Set<Deno.Conn>();
	const tasks = new Set<Promise<void>>();

	async function handle(client: Deno.Conn) {
		let upstream: Deno.Conn | undefined;
		try {
			if (open.size > config.maxConnections) throw new Denied('busy');
			const head = await readHead(client, config.headerTimeoutMs);
			if (head.method !== 'CONNECT') throw new Denied('method');
			checkAuth(head.headers.get('proxy-authorization'), options.token);
			const { host, port } = parseTarget(head.target);
			if (!config.allowedPorts.includes(port)) throw new Denied('port');
			const addresses = await resolveTarget(host, config.resolve);
			upstream = await dialFirst(addresses, port, config.dial, config.connectTimeoutMs);
			await writeAll(client, encoder.encode('HTTP/1.1 200 Connection Established\r\n\r\n'));
			if (head.rest.length > 0) await writeAll(upstream, head.rest);
			await tunnel(client, upstream, config.idleTimeoutMs, config.maxTunnelMs);
		} catch (error) {
			const reason: Denial = error instanceof Denied ? error.reason : 'bad_request';
			config.log('denied', { reason });
			const extra = reason === 'auth' ? 'Proxy-Authenticate: Basic realm="egress"\r\n' : '';
			await writeAll(
				client,
				encoder.encode(
					`HTTP/1.1 ${STATUS[reason]}\r\n${extra}Content-Length: 0\r\nConnection: close\r\n\r\n`
				)
			).catch(() => {});
			try {
				upstream?.close();
			} catch {
				// closed
			}
			try {
				client.close();
			} catch {
				// closed
			}
		}
	}

	const accepting = (async () => {
		for await (const conn of listener) {
			open.add(conn);
			const task = handle(conn).finally(() => {
				open.delete(conn);
				tasks.delete(task);
			});
			tasks.add(task);
		}
	})().catch(() => {});

	return {
		port: (listener.addr as Deno.NetAddr).port,
		active: () => open.size,
		close: async () => {
			listener.close();
			for (const conn of open) {
				try {
					conn.close();
				} catch {
					// closed
				}
			}
			await accepting;
			await Promise.allSettled([...tasks]);
		}
	};
}
