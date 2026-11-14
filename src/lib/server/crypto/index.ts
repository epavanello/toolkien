import { notImplemented } from '#lib/server/not-implemented.ts';
import type { Sealed, WorkspaceCrypto } from './types.ts';

export type { Sealed, WorkspaceCrypto } from './types.ts';

export const encryptForWorkspace: WorkspaceCrypto['encryptForWorkspace'] = async () =>
	notImplemented('crypto.encryptForWorkspace');
export const decryptForWorkspace: WorkspaceCrypto['decryptForWorkspace'] = async () =>
	notImplemented('crypto.decryptForWorkspace');
export const encryptJsonForWorkspace: WorkspaceCrypto['encryptJsonForWorkspace'] = async () =>
	notImplemented('crypto.encryptJsonForWorkspace');
export const decryptJsonForWorkspace = async <T>(
	_workspaceId: string,
	_sealed: Sealed
): Promise<T> => notImplemented('crypto.decryptJsonForWorkspace');
export const rewrap: WorkspaceCrypto['rewrap'] = async () => notImplemented('crypto.rewrap');
