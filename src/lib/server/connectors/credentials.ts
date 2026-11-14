import { and, eq, isNull } from 'drizzle-orm';
import { decryptJsonForWorkspace, encryptJsonForWorkspace } from '#lib/server/crypto/index.ts';
import type { Sealed } from '#lib/server/crypto/types.ts';
import { db } from '#lib/server/db/index.ts';
import { connectorCredential } from '#lib/server/db/schema/index.ts';
import type { ConnectorRow } from './access.ts';

/**
 * Upstream credentials, sealed with the workspace key (`#lib/server/crypto`). Plaintext lives
 * only in memory for the duration of a call; nothing here logs or returns it to callers other
 * than the upstream client.
 */

export type OAuthSecret = { accessToken: string; refreshToken?: string; tokenType?: string };
export type TokenSecret = { token: string };
export type CredentialSecret = OAuthSecret | TokenSecret;

export type CredentialRow = typeof connectorCredential.$inferSelect;

export const toSealedColumns = (sealed: Sealed) => ({
	secretCiphertext: Buffer.from(sealed.ciphertext),
	secretNonce: Buffer.from(sealed.nonce),
	secretKeyVersion: sealed.keyVersion
});

export const fromSealedColumns = (
	ciphertext: Buffer | null,
	nonce: Buffer | null,
	keyVersion: number | null
): Sealed | null =>
	ciphertext && nonce && keyVersion !== null
		? { ciphertext: new Uint8Array(ciphertext), nonce: new Uint8Array(nonce), keyVersion }
		: null;

const ownerFilter = (connectorId: string, userId: string | null) =>
	and(
		eq(connectorCredential.connectorId, connectorId),
		userId === null ? isNull(connectorCredential.userId) : eq(connectorCredential.userId, userId)
	);

export async function findCredential(
	connectorId: string,
	userId: string | null
): Promise<CredentialRow | null> {
	const [row] = await db
		.select()
		.from(connectorCredential)
		.where(ownerFilter(connectorId, userId))
		.limit(1);
	return row ?? null;
}

export async function listCredentials(connectorId: string): Promise<CredentialRow[]> {
	return db
		.select()
		.from(connectorCredential)
		.where(eq(connectorCredential.connectorId, connectorId));
}

export async function openCredential(row: CredentialRow): Promise<CredentialSecret> {
	const sealed = fromSealedColumns(row.secretCiphertext, row.secretNonce, row.secretKeyVersion);
	if (!sealed) throw new Error('Credential has no sealed secret');
	return decryptJsonForWorkspace<CredentialSecret>(row.workspaceId, sealed);
}

/** Replaces the credential of `userId` (`null` = shared) with a freshly sealed one */
export async function saveCredential(
	conn: ConnectorRow,
	userId: string | null,
	kind: 'oauth' | 'token',
	secret: CredentialSecret,
	meta: { scope?: string | null; expiresAt?: Date | null } = {}
) {
	const sealed = await encryptJsonForWorkspace(conn.workspaceId, secret);
	await db.transaction(async (tx) => {
		await tx.delete(connectorCredential).where(ownerFilter(conn.id, userId));
		await tx.insert(connectorCredential).values({
			connectorId: conn.id,
			workspaceId: conn.workspaceId,
			userId,
			kind,
			...toSealedColumns(sealed),
			scope: meta.scope ?? null,
			expiresAt: meta.expiresAt ?? null
		});
	});
}

export async function deleteCredential(connectorId: string, userId: string | null) {
	await db.delete(connectorCredential).where(ownerFilter(connectorId, userId));
}
