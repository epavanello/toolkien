import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createEnvelopeCrypto,
	type DataKeyRecord,
	type DataKeyStore,
	type Resealer
} from './envelope.ts';
import { OpenBaoClient, OpenBaoError } from './openbao.ts';
import type { Sealed } from './types.ts';
import { devWrapper, transitWrapper, type KeyWrapper } from './wrappers.ts';

const MASTER = Buffer.alloc(32, 7).toString('base64');
const WS = 'ws_1';
const OTHER = 'ws_2';

/** In-memory `workspace_data_key` with the same uniqueness rules as the schema */
function memoryStore() {
	const rows: DataKeyRecord[] = [];
	const store: DataKeyStore = {
		getActive: async (ws) =>
			rows.find((r) => r.workspaceId === ws && r.status === 'active') ?? null,
		get: async (ws, v) => rows.find((r) => r.workspaceId === ws && r.keyVersion === v) ?? null,
		list: async (ws) => rows.filter((r) => r.workspaceId === ws).map((r) => ({ ...r })),
		insertActive: async (ws, keyVersion, wrappedKey) => {
			if (rows.some((r) => r.workspaceId === ws && r.keyVersion === keyVersion)) return false;
			for (const r of rows) if (r.workspaceId === ws) r.status = 'retired';
			rows.push({
				id: `k${rows.length}`,
				workspaceId: ws,
				keyVersion,
				wrappedKey,
				status: 'active'
			});
			return true;
		},
		updateWrapped: async (id, wrappedKey) => {
			rows.find((r) => r.id === id)!.wrappedKey = wrappedKey;
		}
	};
	return { rows, store };
}

/** Counts unwraps so the cache can be observed */
function counting(wrapper: KeyWrapper) {
	const calls = { wrap: 0, unwrap: 0, rewrap: 0 };
	const counted: KeyWrapper = {
		kind: wrapper.kind,
		wrap: (...a) => (calls.wrap++, wrapper.wrap(...a)),
		unwrap: (...a) => (calls.unwrap++, wrapper.unwrap(...a)),
		rewrap: (...a) => (calls.rewrap++, wrapper.rewrap(...a))
	};
	return { calls, wrapper: counted };
}

/**
 * Fake OpenBao HTTP API: AppRole login, renew-self and a derived transit key with versions.
 * The "ciphertext" is just tagged base64; what matters is the protocol the client speaks.
 */
function fakeOpenBao(opts: { ttl?: number } = {}) {
	const state = {
		version: 1,
		tokens: new Set<string>(),
		logins: 0,
		renewals: 0,
		requests: [] as { path: string; body: Record<string, string>; token: string | null }[]
	};
	const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		const path = new URL(String(url)).pathname.replace(/^\/v1\//, '');
		const body = JSON.parse(String(init?.body ?? '{}'));
		const token = new Headers(init?.headers).get('x-vault-token');
		state.requests.push({ path, body, token });
		const json = (data: unknown, status = 200) =>
			new Response(JSON.stringify(data), {
				status,
				headers: { 'content-type': 'application/json' }
			});

		if (path === 'auth/approle/login') {
			if (body.role_id !== 'role' || body.secret_id !== 'secret')
				return json({ errors: ['denied'] }, 400);
			const t = `s.${++state.logins}`;
			state.tokens.add(t);
			return json({ auth: { client_token: t, lease_duration: opts.ttl ?? 900, renewable: true } });
		}
		if (!token || !state.tokens.has(token)) return json({ errors: ['permission denied'] }, 403);
		if (path === 'auth/token/renew-self') {
			state.renewals++;
			return json({
				auth: { client_token: token, lease_duration: opts.ttl ?? 900, renewable: true }
			});
		}
		const [, op, key] = path.match(/^transit\/(encrypt|decrypt|rewrap)\/(.+)$/) ?? [];
		if (key !== 'toolkien-tokens') return json({ errors: ['permission denied'] }, 403);
		if (!body.context) return json({ errors: ['missing context for derived key'] }, 400);
		const seal = (plaintext: string) =>
			`vault:v${state.version}:${Buffer.from(JSON.stringify([body.context, plaintext])).toString('base64')}`;
		const open = (ciphertext: string) => {
			const [ctx, plaintext] = JSON.parse(
				Buffer.from(ciphertext.split(':')[2]!, 'base64').toString()
			) as [string, string];
			return ctx === body.context ? plaintext : null;
		};
		if (op === 'encrypt') return json({ data: { ciphertext: seal(body.plaintext!) } });
		const plaintext = open(body.ciphertext!);
		if (plaintext === null) return json({ errors: ['cipher: message authentication failed'] }, 400);
		if (op === 'decrypt') return json({ data: { plaintext } });
		return json({ data: { ciphertext: seal(plaintext) } });
	});
	return { state, fetch };
}

const sealedEquals = (a: Sealed, b: Sealed) =>
	Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext));

afterEach(() => vi.restoreAllMocks());

describe('envelope encryption (dev master key)', () => {
	const setup = (now = () => Date.now()) => {
		const { rows, store } = memoryStore();
		const { calls, wrapper } = counting(devWrapper(MASTER));
		const crypto = createEnvelopeCrypto({ wrapper, store, cacheTtlMs: 1000, now });
		return { rows, calls, crypto };
	};

	it('round-trips bytes, strings and JSON with AES-256-GCM', async () => {
		const { crypto, rows } = setup();
		const sealed = await crypto.encryptForWorkspace(WS, 'gho_upstream_token');
		expect(sealed.nonce.byteLength).toBe(12);
		expect(sealed.keyVersion).toBe(1);
		expect(Buffer.from(sealed.ciphertext).toString()).not.toContain('gho_upstream_token');
		expect(new TextDecoder().decode(await crypto.decryptForWorkspace(WS, sealed))).toBe(
			'gho_upstream_token'
		);

		const json = await crypto.encryptJsonForWorkspace(WS, { accessToken: 'a', n: 1 });
		expect(await crypto.decryptJsonForWorkspace(WS, json)).toEqual({ accessToken: 'a', n: 1 });
		// One DEK per workspace, stored only wrapped
		expect(rows).toHaveLength(1);
		expect(rows[0]!.wrappedKey).toMatch(/^dev:v1:/);
	});

	it('binds ciphertexts to their workspace (AAD) and detects tampering', async () => {
		const { crypto } = setup();
		const sealed = await crypto.encryptForWorkspace(WS, 'secret');
		await crypto.encryptForWorkspace(OTHER, 'x');
		await expect(crypto.decryptForWorkspace(OTHER, sealed)).rejects.toThrow();

		const tampered = { ...sealed, ciphertext: new Uint8Array(sealed.ciphertext) };
		tampered.ciphertext[0]! ^= 1;
		await expect(crypto.decryptForWorkspace(WS, tampered)).rejects.toThrow(
			'Could not open sealed value'
		);
		await expect(crypto.decryptForWorkspace(WS, { ...sealed, keyVersion: 9 })).rejects.toThrow(
			'Unknown data key version'
		);
	});

	it('caches unwrapped DEKs for the TTL only', async () => {
		let clock = 0;
		const { crypto, calls } = setup(() => clock);
		const sealed = await crypto.encryptForWorkspace(WS, 'v');
		crypto.clearCache();
		await crypto.decryptForWorkspace(WS, sealed);
		await crypto.decryptForWorkspace(WS, sealed);
		expect(calls.unwrap).toBe(1);
		clock += 1001;
		await crypto.decryptForWorkspace(WS, sealed);
		expect(calls.unwrap).toBe(2);
	});

	it('creates a single DEK under concurrent first use', async () => {
		const { crypto, rows } = setup();
		const sealed = await Promise.all(
			Array.from({ length: 10 }, (_, i) => crypto.encryptForWorkspace(WS, `v${i}`))
		);
		expect(rows.filter((r) => r.workspaceId === WS && r.status === 'active')).toHaveLength(1);
		for (const [i, s] of sealed.entries()) {
			expect(new TextDecoder().decode(await crypto.decryptForWorkspace(WS, s))).toBe(`v${i}`);
		}
	});

	it('rejects a wrong or malformed master key', async () => {
		const { store } = memoryStore();
		const a = createEnvelopeCrypto({ wrapper: devWrapper(MASTER), store });
		const sealed = await a.encryptForWorkspace(WS, 'x');
		const b = createEnvelopeCrypto({
			wrapper: devWrapper(Buffer.alloc(32, 8).toString('base64')),
			store
		});
		await expect(b.decryptForWorkspace(WS, sealed)).rejects.toThrow();
		expect(() => devWrapper('c2hvcnQ=')).toThrow('32 bytes');
	});

	it('rotates the data key and re-seals old values without downtime', async () => {
		const { rows, store } = memoryStore();
		const values = new Map<string, Sealed>();
		const resealer: Resealer = {
			async reseal(_ws, below, reseal) {
				let n = 0;
				for (const [id, sealed] of values) {
					if (sealed.keyVersion >= below) continue;
					values.set(id, await reseal(sealed));
					n++;
				}
				return n;
			}
		};
		const crypto = createEnvelopeCrypto({ wrapper: devWrapper(MASTER), store, resealer });
		values.set('a', await crypto.encryptForWorkspace(WS, 'alpha'));
		values.set('b', await crypto.encryptForWorkspace(WS, 'beta'));
		const before = values.get('a')!;

		expect(await crypto.rewrap(WS, { rotateDataKey: true })).toEqual({ resealed: 2 });
		expect(rows.map((r) => [r.keyVersion, r.status])).toEqual([
			[1, 'retired'],
			[2, 'active']
		]);
		expect(values.get('a')!.keyVersion).toBe(2);
		expect(sealedEquals(values.get('a')!, before)).toBe(false);
		expect(new TextDecoder().decode(await crypto.decryptForWorkspace(WS, values.get('b')!))).toBe(
			'beta'
		);
		// Values sealed before the rotation and not yet re-sealed still open (retired key)
		expect(new TextDecoder().decode(await crypto.decryptForWorkspace(WS, before))).toBe('alpha');
		expect((await crypto.encryptForWorkspace(WS, 'new')).keyVersion).toBe(2);
	});
});

describe('OpenBao transit', () => {
	const client = (bao: ReturnType<typeof fakeOpenBao>, now = () => Date.now()) =>
		new OpenBaoClient({
			addr: 'http://openbao:8200/',
			roleId: 'role',
			secretId: 'secret',
			keyName: 'toolkien-tokens',
			fetch: bao.fetch as unknown as typeof fetch,
			now
		});

	it('wraps DEKs with the derived key, workspace id as context', async () => {
		const bao = fakeOpenBao();
		const { store, rows } = memoryStore();
		const crypto = createEnvelopeCrypto({ wrapper: transitWrapper(client(bao)), store });
		const sealed = await crypto.encryptForWorkspace(WS, 'tok');
		crypto.clearCache();
		expect(new TextDecoder().decode(await crypto.decryptForWorkspace(WS, sealed))).toBe('tok');

		expect(rows[0]!.wrappedKey).toMatch(/^vault:v1:/);
		const encrypt = bao.state.requests.find((r) => r.path === 'transit/encrypt/toolkien-tokens')!;
		expect(encrypt.body.context).toBe(Buffer.from(WS).toString('base64'));
		expect(encrypt.token).toBe('s.1');
		// The token, not the AppRole secret, authenticates transit calls; one login only
		expect(bao.state.logins).toBe(1);
		expect(
			bao.state.requests.filter((r) => r.path.startsWith('transit')).every((r) => r.token)
		).toBe(true);
	});

	it('a wrapped key moved to another workspace does not unwrap', async () => {
		const bao = fakeOpenBao();
		const wrapper = transitWrapper(client(bao));
		const wrapped = await wrapper.wrap(WS, new Uint8Array(32));
		await expect(wrapper.unwrap(OTHER, wrapped)).rejects.toBeInstanceOf(OpenBaoError);
		await expect(wrapper.unwrap(WS, 'dev:v1:AAAA')).rejects.toThrow('not wrapped by OpenBao');
	});

	it('renews the token before expiry and logs in again after a revocation', async () => {
		let clock = 0;
		const bao = fakeOpenBao({ ttl: 900 });
		const c = client(bao, () => clock);
		await c.encrypt(WS, new Uint8Array([1]));
		clock = 700_000; // less than a third of the TTL left
		await c.encrypt(WS, new Uint8Array([2]));
		expect(bao.state.renewals).toBe(1);
		expect(bao.state.logins).toBe(1);

		bao.state.tokens.clear(); // revoked server side
		await c.encrypt(WS, new Uint8Array([3]));
		expect(bao.state.logins).toBe(2);
	});

	it('rewrap moves wrapped DEKs to the latest transit key version', async () => {
		const bao = fakeOpenBao();
		const { store, rows } = memoryStore();
		const crypto = createEnvelopeCrypto({ wrapper: transitWrapper(client(bao)), store });
		const sealed = await crypto.encryptForWorkspace(WS, 'tok');

		expect(await crypto.rewrap(WS)).toEqual({ resealed: 0 });
		expect(rows[0]!.wrappedKey).toMatch(/^vault:v1:/);
		bao.state.version = 2; // `bao write -f transit/keys/toolkien-tokens/rotate`
		await crypto.rewrap(WS);
		expect(rows[0]!.wrappedKey).toMatch(/^vault:v2:/);
		crypto.clearCache();
		expect(new TextDecoder().decode(await crypto.decryptForWorkspace(WS, sealed))).toBe('tok');
	});

	it('errors carry status only, never bodies, and nothing is logged', async () => {
		const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) =>
			vi.spyOn(console, m).mockImplementation(() => {})
		);
		const bao = fakeOpenBao();
		const bad = new OpenBaoClient({
			addr: 'http://openbao:8200',
			roleId: 'role',
			secretId: 'wrong',
			keyName: 'toolkien-tokens',
			fetch: bao.fetch as unknown as typeof fetch
		});
		const error = await bad
			.encrypt(WS, new TextEncoder().encode('plaintext-secret'))
			.catch((e) => e);
		expect(error).toBeInstanceOf(OpenBaoError);
		expect(error.message).toBe('OpenBao login failed (400)');

		const { store } = memoryStore();
		const crypto = createEnvelopeCrypto({ wrapper: transitWrapper(client(bao)), store });
		const sealed = await crypto.encryptForWorkspace(WS, 'plaintext-secret');
		await crypto.decryptForWorkspace(WS, sealed);
		const failure = await crypto.decryptForWorkspace(OTHER, sealed).catch((e: Error) => e.message);
		expect(failure).not.toContain('plaintext-secret');
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
	});

	it('maps network failures to a content-free error', async () => {
		const c = new OpenBaoClient({
			addr: 'http://openbao:8200',
			roleId: 'role',
			secretId: 'secret',
			keyName: 'toolkien-tokens',
			fetch: (async () => {
				throw new Error('connect ECONNREFUSED 10.0.0.2:8200');
			}) as typeof fetch
		});
		await expect(c.encrypt(WS, new Uint8Array(1))).rejects.toThrow(
			'OpenBao login failed (network error)'
		);
	});
});
