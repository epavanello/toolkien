import { building, dev } from '$app/env';
import {
	OPENBAO_ADDR,
	OPENBAO_ROLE_ID,
	OPENBAO_SECRET_ID,
	OPENBAO_TRANSIT_KEY,
	TOOLKIEN_DEV_MASTER_KEY,
	TOOLKIEN_MASTER_KEY
} from '$app/env/private';
import { db } from '#lib/server/db/index.ts';
import { CryptoError } from './aead.ts';
import { createEnvelopeCrypto, type EnvelopeCrypto } from './envelope.ts';
import { OpenBaoClient } from './openbao.ts';
import { drizzleKeyStore, drizzleResealer, workspacesWithKeys } from './store.ts';
import type { Sealed, WorkspaceCrypto } from './types.ts';
import { devWrapper, masterKeyWrapper, transitWrapper, type KeyWrapper } from './wrappers.ts';

export type { Sealed, WorkspaceCrypto } from './types.ts';
export { CryptoError } from './aead.ts';

// Production needs a real key provider: OpenBao, or an explicit TOOLKIEN_MASTER_KEY. The
// development master key is never an option there.
if (!building && !dev && !OPENBAO_ADDR && !TOOLKIEN_MASTER_KEY) {
	throw new CryptoError('Set OPENBAO_ADDR (recommended) or TOOLKIEN_MASTER_KEY in production');
}

function createWrapper(): KeyWrapper {
	// An explicit master key wins over the compose file's default OPENBAO_ADDR, but never
	// silently over configured OpenBao credentials: data wrapped by one cannot be read by the other
	if (TOOLKIEN_MASTER_KEY) {
		if (OPENBAO_ROLE_ID || OPENBAO_SECRET_ID) {
			throw new CryptoError(
				'TOOLKIEN_MASTER_KEY and OpenBao credentials are both set: keep only one key provider'
			);
		}
		return masterKeyWrapper(TOOLKIEN_MASTER_KEY, 'static');
	}
	if (OPENBAO_ADDR) {
		if (!OPENBAO_ROLE_ID || !OPENBAO_SECRET_ID) {
			throw new CryptoError('OPENBAO_ROLE_ID and OPENBAO_SECRET_ID are required with OPENBAO_ADDR');
		}
		return transitWrapper(
			new OpenBaoClient({
				addr: OPENBAO_ADDR,
				roleId: OPENBAO_ROLE_ID,
				secretId: OPENBAO_SECRET_ID,
				keyName: OPENBAO_TRANSIT_KEY
			})
		);
	}
	if (!dev) throw new CryptoError('The development master key is refused in production');
	if (!TOOLKIEN_DEV_MASTER_KEY) {
		throw new CryptoError(
			'Set OPENBAO_ADDR, TOOLKIEN_MASTER_KEY, or TOOLKIEN_DEV_MASTER_KEY for development (openssl rand -base64 32)'
		);
	}
	return devWrapper(TOOLKIEN_DEV_MASTER_KEY);
}

let instance: EnvelopeCrypto | undefined;
const crypto = () =>
	(instance ??= createEnvelopeCrypto({
		wrapper: createWrapper(),
		store: drizzleKeyStore(db),
		resealer: drizzleResealer(db)
	}));

export const encryptForWorkspace: WorkspaceCrypto['encryptForWorkspace'] = (id, plaintext) =>
	crypto().encryptForWorkspace(id, plaintext);
export const decryptForWorkspace: WorkspaceCrypto['decryptForWorkspace'] = (id, sealed) =>
	crypto().decryptForWorkspace(id, sealed);
export const encryptJsonForWorkspace: WorkspaceCrypto['encryptJsonForWorkspace'] = (id, value) =>
	crypto().encryptJsonForWorkspace(id, value);
export const decryptJsonForWorkspace = <T>(workspaceId: string, sealed: Sealed): Promise<T> =>
	crypto().decryptJsonForWorkspace<T>(workspaceId, sealed);
export const rewrap: WorkspaceCrypto['rewrap'] = (id, opts) => crypto().rewrap(id, opts);

/** Drops cached data keys (kill switch, incident response) */
export const clearKeyCache = () => instance?.clearCache();

/**
 * Re-wraps every workspace's data keys with the latest transit key version. Run after
 * `bao write -f transit/keys/toolkien-tokens/rotate` (see `deploy/openbao/README.md`); with
 * `rotateDataKey` it also rotates every DEK and re-seals all values.
 */
export async function rewrapAllWorkspaces(opts: { rotateDataKey?: boolean } = {}) {
	let workspaces = 0;
	let resealed = 0;
	for (const workspaceId of await workspacesWithKeys(db)) {
		resealed += (await rewrap(workspaceId, opts)).resealed;
		workspaces++;
	}
	return { workspaces, resealed };
}
