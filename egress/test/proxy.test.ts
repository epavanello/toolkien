import { assert, assertEquals, assertRejects } from '@std/assert';
import { isAllowedAddress } from '../src/ip.ts';
import { parseTarget, type ProxyServer, resolveTarget, startProxy } from '../src/proxy.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const TOKEN = 'test-token';
const auth = `Proxy-Authorization: Basic ${btoa(`toolkien:${TOKEN}`)}\r\n`;

const table: Record<string, string[]> = {
	'api.example.com': ['93.184.216.34'],
	'v6.example.com': ['2606:4700::1111'],
	'rebind.example.com': ['93.184.216.34', '10.0.0.1'],
	'metadata.example.com': ['169.254.169.254'],
	'mapped.example.com': ['::ffff:127.0.0.1']
};

/** Echo server standing in for every upstream; records which address the proxy dialled */
async function withProxy(
	fn: (proxy: ProxyServer, dialled: string[]) => Promise<void>,
	options: Parameters<typeof startProxy>[0] = {}
) {
	const echo = Deno.listen({ hostname: '127.0.0.1', port: 0 });
	const echoPort = (echo.addr as Deno.NetAddr).port;
	const echoing = (async () => {
		for await (const conn of echo) {
			conn.readable.pipeTo(conn.writable).catch(() => {});
		}
	})().catch(() => {});
	const dialled: string[] = [];
	const proxy = startProxy({
		hostname: '127.0.0.1',
		port: 0,
		token: TOKEN,
		resolve: (host) =>
			host in table ? Promise.resolve(table[host]!) : Promise.reject(new Error('NXDOMAIN')),
		dial: (address) => {
			dialled.push(address);
			return Deno.connect({ hostname: '127.0.0.1', port: echoPort });
		},
		log: () => {},
		...options
	});
	try {
		await fn(proxy, dialled);
	} finally {
		await proxy.close();
		echo.close();
		await echoing;
	}
}

/** Sends a raw request head, returns the status line and the open connection */
async function request(proxy: ProxyServer, head: string) {
	const conn = await Deno.connect({ hostname: '127.0.0.1', port: proxy.port });
	await conn.write(encoder.encode(head));
	const buffer = new Uint8Array(1024);
	let text = '';
	while (!text.includes('\r\n\r\n')) {
		const n = await conn.read(buffer);
		if (n === null) break;
		text += decoder.decode(buffer.subarray(0, n));
	}
	return { status: text.split('\r\n')[0] ?? '', headers: text, conn };
}

const connect = (target: string, headers = auth) =>
	`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${headers}\r\n`;

async function statusOf(proxy: ProxyServer, head: string) {
	const { status, conn } = await request(proxy, head);
	try {
		conn.close();
	} catch {
		// closed by the proxy
	}
	return status;
}

Deno.test('tunnels CONNECT to a public host on 443 and dials the checked address', async () => {
	await withProxy(async (proxy, dialled) => {
		const { status, conn } = await request(proxy, connect('api.example.com:443'));
		assertEquals(status, 'HTTP/1.1 200 Connection Established');
		await conn.write(encoder.encode('ping'));
		const buffer = new Uint8Array(4);
		await conn.read(buffer);
		assertEquals(decoder.decode(buffer), 'ping');
		conn.close();
		assertEquals(dialled, ['93.184.216.34']);
	});
});

Deno.test('IPv6 literals and AAAA records are supported', async () => {
	await withProxy(async (proxy, dialled) => {
		assertEquals(
			await statusOf(proxy, connect('v6.example.com:443')),
			'HTTP/1.1 200 Connection Established'
		);
		assertEquals(
			await statusOf(proxy, connect('[2606:4700:4700::1111]:443')),
			'HTTP/1.1 200 Connection Established'
		);
		assertEquals(dialled, ['2606:4700::1111', '2606:4700:4700::1111']);
	});
});

Deno.test('refuses private, loopback, metadata, mapped and internal destinations', async () => {
	await withProxy(async (proxy, dialled) => {
		for (const target of [
			'127.0.0.1:443',
			'10.0.0.5:443',
			'172.17.0.1:443',
			'169.254.169.254:443',
			'100.64.0.1:443',
			'[::1]:443',
			'[fd00:ec2::254]:443',
			'[::ffff:10.0.0.1]:443',
			'[64:ff9b::a9fe:a9fe]:443',
			'openbao:443',
			'localhost:443',
			'vault.internal:443',
			'rebind.example.com:443',
			'metadata.example.com:443',
			'mapped.example.com:443'
		]) {
			assertEquals(await statusOf(proxy, connect(target)), 'HTTP/1.1 403 Forbidden', target);
		}
		assertEquals(dialled, []);
	});
});

Deno.test('only CONNECT, only 443, only with the token', async () => {
	await withProxy(async (proxy, dialled) => {
		assertEquals(
			await statusOf(
				proxy,
				`GET http://api.example.com/ HTTP/1.1\r\nHost: api.example.com\r\n${auth}\r\n`
			),
			'HTTP/1.1 405 Method Not Allowed'
		);
		assertEquals(await statusOf(proxy, connect('api.example.com:80')), 'HTTP/1.1 403 Forbidden');
		assertEquals(await statusOf(proxy, connect('api.example.com:22')), 'HTTP/1.1 403 Forbidden');
		const missing = await request(proxy, connect('api.example.com:443', ''));
		assertEquals(missing.status, 'HTTP/1.1 407 Proxy Authentication Required');
		assert(missing.headers.includes('Proxy-Authenticate: Basic'));
		missing.conn.close();
		const wrong = `Proxy-Authorization: Basic ${btoa('toolkien:nope')}\r\n`;
		assertEquals(
			await statusOf(proxy, connect('api.example.com:443', wrong)),
			'HTTP/1.1 407 Proxy Authentication Required'
		);
		assertEquals(
			await statusOf(proxy, connect('nxdomain.example.com:443')),
			'HTTP/1.1 502 Bad Gateway'
		);
		assertEquals(await statusOf(proxy, 'garbage\r\n\r\n'), 'HTTP/1.1 400 Bad Request');
		assertEquals(dialled, []);
	});
});

Deno.test('closes idle tunnels', async () => {
	await withProxy(
		async (proxy) => {
			const { status, conn } = await request(proxy, connect('api.example.com:443'));
			assertEquals(status, 'HTTP/1.1 200 Connection Established');
			const closed = await conn.read(new Uint8Array(1));
			assertEquals(closed, null);
			conn.close();
		},
		{ idleTimeoutMs: 200 }
	);
});

Deno.test('caps concurrent connections', async () => {
	await withProxy(
		async (proxy) => {
			const first = await request(proxy, connect('api.example.com:443'));
			assertEquals(first.status, 'HTTP/1.1 200 Connection Established');
			assertEquals(
				await statusOf(proxy, connect('api.example.com:443')),
				'HTTP/1.1 503 Service Unavailable'
			);
			first.conn.close();
		},
		{ maxConnections: 1 }
	);
});

Deno.test('parseTarget and resolveTarget', async () => {
	assertEquals(parseTarget('Example.COM.:443'), { host: 'example.com', port: 443 });
	assertEquals(parseTarget('[2001:4860::8888]:443'), { host: '2001:4860::8888', port: 443 });
	for (const bad of ['example.com', 'http://x:443', '[nothex]:443', 'a b:443', 'x.com:99999']) {
		let threw = false;
		try {
			parseTarget(bad);
		} catch {
			threw = true;
		}
		assert(threw, bad);
	}
	await assertRejects(() => resolveTarget('empty.example.com', () => Promise.resolve([])));
	assertEquals(await resolveTarget('1.1.1.1', () => Promise.resolve([])), ['1.1.1.1']);
	assert(!isAllowedAddress('::ffff:169.254.169.254'));
});

Deno.test('IP policy stays identical to the app copy', async () => {
	let app: string;
	try {
		app = await Deno.readTextFile(new URL('../../src/lib/server/net/ip.ts', import.meta.url));
	} catch {
		return; // egress built on its own (Docker context): nothing to compare
	}
	const egress = await Deno.readTextFile(new URL('../src/ip.ts', import.meta.url));
	assertEquals(egress, app, 'egress/src/ip.ts must be a copy of src/lib/server/net/ip.ts');
});

Deno.test('alternative IP notations and special IPv6 forms never get dialled', async () => {
	await withProxy(async (proxy, dialled) => {
		for (const target of [
			'2130706433:443', // 127.0.0.1 as a decimal integer
			'0x7f.0.0.1:443', // hex octet
			'0177.0.0.1:443', // octal octet
			'127.1:443', // short form
			'0.0.0.0:443',
			'[::]:443',
			'[::ffff:7f00:1]:443', // IPv4-mapped, hex form
			'[::127.0.0.1]:443', // IPv4-compatible
			'[2002:7f00:1::]:443', // 6to4 embedding 127.0.0.1
			'[2001:db8::1]:443', // documentation
			'[fe80::1]:443', // link-local
			'[ff02::1]:443' // multicast
		]) {
			const status = await statusOf(proxy, connect(target));
			assert(
				['HTTP/1.1 403 Forbidden', 'HTTP/1.1 400 Bad Request', 'HTTP/1.1 502 Bad Gateway'].includes(
					status
				),
				`${target}: ${status}`
			);
		}
		assertEquals(dialled, []);
	});
	for (const address of [
		'0.0.0.0',
		'::',
		'::ffff:7f00:1',
		'::127.0.0.1',
		'2002:7f00:1::',
		'fe80::1%eth0'
	]) {
		assert(!isAllowedAddress(address), address);
	}
	assert(isAllowedAddress('2606:4700:4700::1111'));
	assert(isAllowedAddress('1.1.1.1'));
});
