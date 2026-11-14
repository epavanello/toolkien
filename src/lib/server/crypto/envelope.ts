import {
	CryptoError,
	KEY_BYTES,
	aesGcmOpen,
	aesGcmSeal,
	importAesKey,
	randomBytes
} from './aead.ts';
import type { Sealed, WorkspaceCrypto } from './types.ts';
import type { KeyWrapper } from './wrappers.ts';

/** One row of `workspace_data_key` */
export type DataKeyRecord = {
	id: string;
	workspaceId: string;
	keyVersion: number;
	/** `vault:vN:…` (OpenBao transit) or `dev:v1:…` */
	wrappedKey: string;
	status: 'active' | 'retired';
};

export interface DataKeyStore {
	getActive(workspaceId: string): Promise<DataKeyRecord | null>;
	get(workspaceId: string, keyVersion: number): Promise<DataKeyRecord | null>;
	list(workspaceId: string): Promise<DataKeyRecord[]>;
	/**
	 * Inserts `keyVersion` as the active key and retires the previous active one, atomically.
	 * Returns `false` when another writer won the race (unique index on version / active).
	 */
	insertActive(workspaceId: string, keyVersion: number, wrappedKey: string): Promise<boolean>;
	updateWrapped(id: string, wrappedKey: string): Promise<void>;
}

/**
 * Re-seals every sealed value of a workspace whose key version is below `belowVersion`.
 * `reseal` opens with the old key and seals with the active one; returns how many changed.
 */
export interface Resealer {
	reseal(
		workspaceId: string,
		belowVersion: number,
		reseal: (sealed: Sealed) => Promise<Sealed>
	): Promise<number>;
}

export type EnvelopeOptions = {
	wrapper: KeyWrapper;
	store: DataKeyStore;
	resealer?: Resealer;
	/** How long an unwrapped DEK stays in memory (default 5 min) */
	cacheTtlMs?: number;
	/** Upper bound of cached DEKs (default 1000) */
	maxCachedKeys?: number;
	now?: () => number;
};

export type EnvelopeCrypto = WorkspaceCrypto & {
	/** Drops every cached DEK (tests, kill switch, after a master key incident) */
	clearCache(): void;
};

type CachedKey = { key: CryptoKey; expiresAt: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createEnvelopeCrypto(options: EnvelopeOptions): EnvelopeCrypto {
	const { wrapper, store, resealer } = options;
	const ttl = options.cacheTtlMs ?? 5 * 60_000;
	const maxKeys = options.maxCachedKeys ?? 1000;
	const now = options.now ?? Date.now;

	const keys = new Map<string, CachedKey>();
	const active = new Map<string, { version: number; expiresAt: number }>();
	const inflight = new Map<string, Promise<CryptoKey>>();

	const cacheKey = (workspaceId: string, version: number) => `${workspaceId}\u0000${version}`;

	function remember(workspaceId: string, version: number, key: CryptoKey) {
		const id = cacheKey(workspaceId, version);
		keys.delete(id);
		keys.set(id, { key, expiresAt: now() + ttl });
		// Map keeps insertion order: evict the oldest
		while (keys.size > maxKeys) keys.delete(keys.keys().next().value!);
	}

	async function importWrapped(record: DataKeyRecord): Promise<CryptoKey> {
		const raw = await wrapper.unwrap(record.workspaceId, record.wrappedKey);
		try {
			return await importAesKey(raw);
		} finally {
			raw.fill(0);
		}
	}

	async function keyFor(workspaceId: string, version: number): Promise<CryptoKey> {
		const id = cacheKey(workspaceId, version);
		const cached = keys.get(id);
		if (cached && cached.expiresAt > now()) return cached.key;
		let pending = inflight.get(id);
		if (!pending) {
			pending = (async () => {
				const record = await store.get(workspaceId, version);
				if (!record) throw new CryptoError('Unknown data key version');
				const key = await importWrapped(record);
				remember(workspaceId, version, key);
				return key;
			})().finally(() => inflight.delete(id));
			inflight.set(id, pending);
		}
		return pending;
	}

	/** Creates and stores a new DEK version; returns `null` if another writer raced us */
	async function createVersion(workspaceId: string, version: number) {
		const raw = randomBytes(KEY_BYTES);
		try {
			const wrapped = await wrapper.wrap(workspaceId, raw);
			if (!(await store.insertActive(workspaceId, version, wrapped))) return null;
			const key = await importAesKey(raw);
			remember(workspaceId, version, key);
			active.set(workspaceId, { version, expiresAt: now() + ttl });
			return { version, key };
		} finally {
			raw.fill(0);
		}
	}

	async function activeKey(workspaceId: string): Promise<{ version: number; key: CryptoKey }> {
		const cached = active.get(workspaceId);
		if (cached && cached.expiresAt > now()) {
			return { version: cached.version, key: await keyFor(workspaceId, cached.version) };
		}
		for (let attempt = 0; attempt < 3; attempt++) {
			const record = await store.getActive(workspaceId);
			if (record) {
				active.set(workspaceId, { version: record.keyVersion, expiresAt: now() + ttl });
				return { version: record.keyVersion, key: await keyFor(workspaceId, record.keyVersion) };
			}
			// First use: create version 1 (or the next free one); on a race, read the winner
			const versions = await store.list(workspaceId);
			const next = Math.max(0, ...versions.map((v) => v.keyVersion)) + 1;
			const created = await createVersion(workspaceId, next);
			if (created) return created;
		}
		throw new CryptoError('Could not establish a workspace data key');
	}

	const toBytes = (value: Uint8Array | string) =>
		typeof value === 'string' ? encoder.encode(value) : value;

	const encryptForWorkspace: WorkspaceCrypto['encryptForWorkspace'] = async (
		workspaceId,
		plaintext
	) => {
		const { version, key } = await activeKey(workspaceId);
		const { ciphertext, nonce } = await aesGcmSeal(key, toBytes(plaintext), workspaceId);
		return { ciphertext, nonce, keyVersion: version };
	};

	const decryptForWorkspace: WorkspaceCrypto['decryptForWorkspace'] = async (
		workspaceId,
		sealed
	) => {
		const key = await keyFor(workspaceId, sealed.keyVersion);
		return aesGcmOpen(key, sealed.ciphertext, sealed.nonce, workspaceId);
	};

	const rewrap: WorkspaceCrypto['rewrap'] = async (workspaceId, opts = {}) => {
		// 1. Every DEK version re-wrapped with the latest master key version (no plaintext leaves
		//    OpenBao; a no-op when already current)
		for (const record of await store.list(workspaceId)) {
			const rewrapped = await wrapper.rewrap(workspaceId, record.wrappedKey);
			if (rewrapped !== record.wrappedKey) await store.updateWrapped(record.id, rewrapped);
		}
		if (!opts.rotateDataKey) return { resealed: 0 };

		// 2. New active DEK version; old versions stay readable (retired) while values move over
		let created: { version: number } | null = null;
		for (let attempt = 0; attempt < 3 && !created; attempt++) {
			const versions = await store.list(workspaceId);
			created = await createVersion(
				workspaceId,
				Math.max(0, ...versions.map((v) => v.keyVersion)) + 1
			);
		}
		if (!created) throw new CryptoError('Could not rotate the workspace data key');
		if (!resealer) return { resealed: 0 };

		// 3. Re-seal values sealed with older versions (optimistic per row; safe to re-run)
		const resealed = await resealer.reseal(workspaceId, created.version, async (sealed) => {
			const plaintext = await decryptForWorkspace(workspaceId, sealed);
			try {
				return await encryptForWorkspace(workspaceId, plaintext);
			} finally {
				plaintext.fill(0);
			}
		});
		return { resealed };
	};

	return {
		encryptForWorkspace,
		decryptForWorkspace,
		encryptJsonForWorkspace: (workspaceId, value) =>
			encryptForWorkspace(workspaceId, JSON.stringify(value)),
		decryptJsonForWorkspace: async <T>(workspaceId: string, sealed: Sealed) =>
			JSON.parse(decoder.decode(await decryptForWorkspace(workspaceId, sealed))) as T,
		rewrap,
		clearCache: () => {
			keys.clear();
			active.clear();
		}
	};
}
