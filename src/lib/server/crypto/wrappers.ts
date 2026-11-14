import {
	CryptoError,
	KEY_BYTES,
	aesGcmOpen,
	aesGcmSeal,
	deriveAesKey,
	fromBase64,
	toBase64
} from './aead.ts';
import type { OpenBaoClient } from './openbao.ts';

/**
 * Wraps and unwraps workspace data keys. Production: OpenBao transit (the master key never
 * leaves OpenBao). Development: a local master key from `TOOLKIEN_DEV_MASTER_KEY`.
 */
export interface KeyWrapper {
	readonly kind: 'openbao' | 'dev';
	wrap(workspaceId: string, dek: Uint8Array): Promise<string>;
	unwrap(workspaceId: string, wrapped: string): Promise<Uint8Array>;
	/** Re-wraps with the latest master key version; returns the input when already current */
	rewrap(workspaceId: string, wrapped: string): Promise<string>;
}

export function transitWrapper(client: OpenBaoClient): KeyWrapper {
	return {
		kind: 'openbao',
		wrap: (workspaceId, dek) => client.encrypt(workspaceId, dek),
		unwrap: async (workspaceId, wrapped) => {
			if (!wrapped.startsWith('vault:'))
				throw new CryptoError('Data key was not wrapped by OpenBao');
			return client.decrypt(workspaceId, wrapped);
		},
		rewrap: (workspaceId, wrapped) => client.rewrap(workspaceId, wrapped)
	};
}

const DEV_PREFIX = 'dev:v1:';

/** HKDF(master, info = workspace id) per workspace, AES-GCM with the workspace id as AAD */
export function devWrapper(masterKeyBase64: string): KeyWrapper {
	const master = fromBase64(masterKeyBase64);
	if (master.byteLength !== KEY_BYTES) {
		throw new CryptoError('TOOLKIEN_DEV_MASTER_KEY must be 32 bytes, base64 encoded');
	}
	const kek = (workspaceId: string) => deriveAesKey(master, 'toolkien-dev-kek', workspaceId);
	return {
		kind: 'dev',
		wrap: async (workspaceId, dek) => {
			const { ciphertext, nonce } = await aesGcmSeal(await kek(workspaceId), dek, workspaceId);
			const packed = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
			packed.set(nonce);
			packed.set(ciphertext, nonce.byteLength);
			return `${DEV_PREFIX}${toBase64(packed)}`;
		},
		unwrap: async (workspaceId, wrapped) => {
			if (!wrapped.startsWith(DEV_PREFIX)) {
				throw new CryptoError('Data key was not wrapped by the development master key');
			}
			const packed = fromBase64(wrapped.slice(DEV_PREFIX.length));
			return aesGcmOpen(await kek(workspaceId), packed.slice(12), packed.slice(0, 12), workspaceId);
		},
		rewrap: async (_workspaceId, wrapped) => wrapped
	};
}
