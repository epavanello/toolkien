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
 * Wraps and unwraps workspace data keys.
 * - `openbao`: OpenBao transit, the master key never leaves OpenBao (recommended).
 * - `static`: a master key from `TOOLKIEN_MASTER_KEY` in the app environment (simpler
 *   self-hosting, weaker: whoever reads the environment can unwrap every data key).
 * - `dev`: `TOOLKIEN_DEV_MASTER_KEY`, development only.
 */
export interface KeyWrapper {
	readonly kind: 'openbao' | 'static' | 'dev';
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

const MASTER_KEY_ENV = { static: 'TOOLKIEN_MASTER_KEY', dev: 'TOOLKIEN_DEV_MASTER_KEY' } as const;

/**
 * Local master key: HKDF(master, info = workspace id) per workspace, AES-GCM with the workspace
 * id as AAD. `static` and `dev` use distinct prefixes and HKDF labels, so a development key can
 * never open production data and vice versa.
 */
export function masterKeyWrapper(masterKeyBase64: string, kind: 'static' | 'dev'): KeyWrapper {
	const master = fromBase64(masterKeyBase64);
	if (master.byteLength !== KEY_BYTES) {
		throw new CryptoError(`${MASTER_KEY_ENV[kind]} must be 32 bytes, base64 encoded`);
	}
	const prefix = `${kind}:v1:`;
	const kek = (workspaceId: string) => deriveAesKey(master, `toolkien-${kind}-kek`, workspaceId);
	return {
		kind,
		wrap: async (workspaceId, dek) => {
			const { ciphertext, nonce } = await aesGcmSeal(await kek(workspaceId), dek, workspaceId);
			const packed = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
			packed.set(nonce);
			packed.set(ciphertext, nonce.byteLength);
			return `${prefix}${toBase64(packed)}`;
		},
		unwrap: async (workspaceId, wrapped) => {
			if (!wrapped.startsWith(prefix)) {
				throw new CryptoError(`Data key was not wrapped by ${MASTER_KEY_ENV[kind]}`);
			}
			const packed = fromBase64(wrapped.slice(prefix.length));
			return aesGcmOpen(await kek(workspaceId), packed.slice(12), packed.slice(0, 12), workspaceId);
		},
		rewrap: async (_workspaceId, wrapped) => wrapped
	};
}

export const devWrapper = (masterKeyBase64: string) => masterKeyWrapper(masterKeyBase64, 'dev');
