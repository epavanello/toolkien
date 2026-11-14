import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isAllowedAddress } from './ip.ts';
import {
	assertSafeUrlWith,
	createPinnedLookup,
	validateUrlShape,
	type Resolver
} from './policy.ts';
import { createSafeFetch } from './fetch.ts';
import { UnsafeUrlError, type UnsafeUrlReason } from './types.ts';

const reason = async (promise: Promise<unknown>): Promise<UnsafeUrlReason | 'ok'> => {
	try {
		await promise;
		return 'ok';
	} catch (error) {
		if (error instanceof UnsafeUrlError) return error.reason;
		throw error;
	}
};
const syncReason = (fn: () => unknown) => reason(Promise.resolve().then(fn));

const staticResolver =
	(table: Record<string, string[]>): Resolver =>
	async (hostname) => {
		const addresses = table[hostname];
		if (!addresses) throw new Error('ENOTFOUND');
		return addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
	};

describe('isAllowedAddress', () => {
	it.each([
		'127.0.0.1',
		'10.1.2.3',
		'172.17.0.2', // Docker default bridge
		'192.168.1.1',
		'100.64.0.1', // CGNAT
		'100.100.100.200', // Alibaba metadata
		'169.254.169.254', // cloud metadata
		'0.0.0.0',
		'224.0.0.1',
		'255.255.255.255',
		'192.0.0.192',
		'::1',
		'::',
		'fe80::1',
		'fd00:ec2::254', // AWS metadata over IPv6
		'fc00::1', // ULA
		'ff02::1',
		'::ffff:127.0.0.1', // IPv4-mapped
		'::ffff:7f00:1',
		'::ffff:169.254.169.254',
		'::127.0.0.1', // IPv4-compatible
		'64:ff9b::a9fe:a9fe', // NAT64 of 169.254.169.254
		'2002:7f00:1::', // 6to4 of 127.0.0.1
		'2001::1', // Teredo
		'2001:db8::1'
	])('blocks %s', (address) => {
		expect(isAllowedAddress(address)).toBe(false);
	});

	it.each(['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111', '2a00:1450:4001:80b::200e'])(
		'allows public %s',
		(address) => {
			expect(isAllowedAddress(address)).toBe(true);
		}
	);

	it('allows loopback only when the policy says so, and extra ranges can be blocked', () => {
		expect(isAllowedAddress('127.0.0.1', { allowLoopback: true })).toBe(true);
		expect(isAllowedAddress('10.0.0.1', { allowLoopback: true })).toBe(false);
		expect(isAllowedAddress('1.1.1.1', { extraBlocked: ['1.1.1.0/24'] })).toBe(false);
	});
});

describe('validateUrlShape / assertSafeUrl', () => {
	it.each<[string, UnsafeUrlReason]>([
		['not a url', 'invalid_url'],
		['http://example.com/', 'scheme'],
		['ftp://example.com/', 'scheme'],
		['file:///etc/passwd', 'scheme'],
		['https://user:pass@example.com/', 'credentials_in_url'],
		['https://example.com:8443/', 'port'],
		['https://127.0.0.1/', 'blocked_address'],
		['https://2130706433/', 'blocked_address'], // decimal 127.0.0.1
		['https://0x7f.1/', 'blocked_address'], // hex shorthand
		['https://[::1]/', 'blocked_address'],
		['https://[::ffff:169.254.169.254]/', 'blocked_address'],
		['https://[fd00:ec2::254]/', 'blocked_address'],
		['https://localhost/', 'blocked_address'],
		['https://openbao.internal/', 'blocked_address']
	])('rejects %s (%s)', async (url, expected) => {
		expect(await syncReason(() => validateUrlShape(url))).toBe(expected);
	});

	it('checks every resolved address, A and AAAA', async () => {
		const resolver = staticResolver({
			'ok.test': ['93.184.216.34', '2606:4700::1'],
			'mixed.test': ['93.184.216.34', '10.0.0.5'],
			'v6.test': ['fd12::1'],
			'empty.test': []
		});
		expect(await reason(assertSafeUrlWith('https://ok.test/x', { resolver }))).toBe('ok');
		expect(await reason(assertSafeUrlWith('https://mixed.test/', { resolver }))).toBe(
			'blocked_address'
		);
		expect(await reason(assertSafeUrlWith('https://v6.test/', { resolver }))).toBe(
			'blocked_address'
		);
		expect(await reason(assertSafeUrlWith('https://empty.test/', { resolver }))).toBe(
			'dns_failure'
		);
		expect(await reason(assertSafeUrlWith('https://missing.test/', { resolver }))).toBe(
			'dns_failure'
		);
	});

	it('allows http only to loopback, and only in development', async () => {
		expect(await syncReason(() => validateUrlShape('http://127.0.0.1:5173/'))).toBe('scheme');
		const dev = { allowLoopback: true };
		expect(await syncReason(() => validateUrlShape('http://127.0.0.1:5173/', dev))).toBe('ok');
		expect(await syncReason(() => validateUrlShape('http://localhost:8080/', dev))).toBe('ok');
		expect(await syncReason(() => validateUrlShape('http://10.0.0.1/', dev))).toBe('scheme');
	});
});

describe('DNS rebinding', () => {
	it('checks the address handed to the socket, not an earlier answer', async () => {
		let calls = 0;
		const resolver: Resolver = async () =>
			calls++ === 0
				? [{ address: '93.184.216.34', family: 4 }]
				: [{ address: '169.254.169.254', family: 4 }];

		// The pre-check sees a public address…
		expect(await reason(assertSafeUrlWith('https://rebind.test/', { resolver }))).toBe('ok');
		// …but the connect-time lookup sees the rebound one and refuses to hand it to the socket
		const lookup = createPinnedLookup({ resolver });
		const error = await new Promise((resolve) =>
			lookup('rebind.test', { all: true }, (err) => resolve(err))
		);
		expect(error).toBeInstanceOf(UnsafeUrlError);
		expect((error as UnsafeUrlError).reason).toBe('blocked_address');
	});

	it('safeFetch fails closed when the connect-time answer is private', async () => {
		const safeFetch = createSafeFetch({
			resolver: staticResolver({ 'rebind.test': ['10.0.0.7'] })
		});
		expect(await reason(safeFetch('https://rebind.test/'))).toBe('blocked_address');
	});
});

describe('safeFetch against a local server', () => {
	let server: Server;
	let base: string;
	let seen: IncomingHttpHeaders[] = [];

	beforeAll(async () => {
		server = createServer((req, res) => {
			seen.push(req.headers);
			const url = new URL(req.url!, 'http://x');
			const to = url.searchParams.get('to');
			if (url.pathname === '/redirect' && to) {
				res.writeHead(Number(url.searchParams.get('status') ?? 302), { location: to }).end();
			} else if (url.pathname === '/big') {
				res.writeHead(200);
				res.end(Buffer.alloc(64 * 1024, 1));
			} else if (url.pathname === '/slow') {
				setTimeout(() => res.end('late'), 500);
			} else {
				res.writeHead(200, { 'content-type': 'text/plain' }).end(`${req.method} ok`);
			}
		});
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

	const devFetch = createSafeFetch({
		allowLoopback: true,
		resolver: staticResolver({ 'evil.test': ['192.168.0.10'] })
	});

	it('refuses redirects by default and follows them when allowed', async () => {
		const target = encodeURIComponent(`${base}/final`);
		expect(await reason(devFetch(`${base}/redirect?to=${target}`))).toBe('too_many_redirects');
		const response = await devFetch(`${base}/redirect?to=${target}`, { maxRedirects: 1 });
		expect(await response.text()).toBe('GET ok');
		expect(response.url).toBe(`${base}/final`);
	});

	it.each([
		'https://169.254.169.254/latest/meta-data/',
		'https://10.0.0.1/',
		'https://[::ffff:10.0.0.1]/',
		'https://evil.test/',
		'http://example.com/'
	])('re-checks every hop: redirect to %s is blocked', async (to) => {
		const result = await reason(
			devFetch(`${base}/redirect?to=${encodeURIComponent(to)}`, { maxRedirects: 3 })
		);
		expect(['blocked_address', 'scheme']).toContain(result);
	});

	it('drops credentials on cross-origin redirects and turns 303 into GET', async () => {
		seen = [];
		const other = base.replace('127.0.0.1', 'localhost');
		const response = await devFetch(
			`${base}/redirect?status=303&to=${encodeURIComponent(`${other}/final`)}`,
			{ method: 'POST', body: 'x', headers: { authorization: 'Bearer secret' }, maxRedirects: 1 }
		);
		expect(await response.text()).toBe('GET ok');
		expect(seen[0]?.authorization).toBe('Bearer secret');
		expect(seen[1]?.authorization).toBeUndefined();
	});

	it('bounds response size and time', async () => {
		const response = await devFetch(`${base}/big`, { maxResponseBytes: 1024 });
		expect(await reason(response.arrayBuffer())).toBe('response_too_large');
		expect(await reason(devFetch(`${base}/slow`, { timeoutMs: 100 }))).toBe('timeout');
	});
});

describe('safeFetch through the egress proxy', () => {
	it('maps a 403 from the proxy to blocked_address', async () => {
		const proxy = createServer();
		proxy.on('connect', (_req, socket) => {
			socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
		});
		await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
		const port = (proxy.address() as AddressInfo).port;
		try {
			const safeFetch = createSafeFetch({
				proxyUrl: `http://toolkien:token@127.0.0.1:${port}`,
				resolver: staticResolver({ 'api.test': ['93.184.216.34'] })
			});
			expect(await reason(safeFetch('https://api.test/'))).toBe('blocked_address');
			// The app pre-checks too: a private name never reaches the proxy
			expect(await reason(safeFetch('https://10.0.0.1/'))).toBe('blocked_address');
		} finally {
			proxy.close();
		}
	});

	it('sends the proxy credentials as Proxy-Authorization', async () => {
		const proxy = createServer();
		let auth: string | undefined;
		proxy.on('connect', (req, socket) => {
			auth = req.headers['proxy-authorization'];
			socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
		});
		await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
		const port = (proxy.address() as AddressInfo).port;
		try {
			const safeFetch = createSafeFetch({
				proxyUrl: `http://toolkien:s3cret@127.0.0.1:${port}`,
				resolver: staticResolver({ 'api.test': ['93.184.216.34'] })
			});
			await reason(safeFetch('https://api.test/'));
			expect(auth).toBe(`Basic ${Buffer.from('toolkien:s3cret').toString('base64')}`);
		} finally {
			proxy.close();
		}
	});
});
