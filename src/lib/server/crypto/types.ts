/**
 * Envelope encryption contract (owner: infra).
 *
 * - One data key (DEK, 32 random bytes) per workspace and version, stored only wrapped by the
 *   OpenBao transit key `OPENBAO_TRANSIT_KEY` (derived, context = workspace id) in
 *   `workspace_data_key`. The master key never leaves OpenBao.
 * - Values are sealed with AES-256-GCM, 12-byte random nonce, and the workspace id as
 *   associated data: a ciphertext moved to another workspace fails to decrypt.
 * - Unwrapped DEKs may be cached in memory for a short TTL; they are never written anywhere.
 * - Without `OPENBAO_ADDR`, development uses `TOOLKIEN_DEV_MASTER_KEY`; production refuses to
 *   start without OpenBao.
 * - Plaintext, DEKs and ciphertexts never appear in logs or error messages.
 */

/** What the `sealed(prefix)` columns of the schema store */
export type Sealed = {
	ciphertext: Uint8Array;
	nonce: Uint8Array;
	/** `workspace_data_key.key_version` that sealed it */
	keyVersion: number;
};

export interface WorkspaceCrypto {
	/** Seals bytes or a UTF-8 string with the workspace's active DEK (creating it on first use) */
	encryptForWorkspace(workspaceId: string, plaintext: Uint8Array | string): Promise<Sealed>;
	/** Opens a sealed value; throws if the workspace, key version or tag do not match */
	decryptForWorkspace(workspaceId: string, sealed: Sealed): Promise<Uint8Array>;
	/** JSON convenience wrappers over the two above */
	encryptJsonForWorkspace(workspaceId: string, value: unknown): Promise<Sealed>;
	decryptJsonForWorkspace<T>(workspaceId: string, sealed: Sealed): Promise<T>;
	/**
	 * Key rotation without downtime: re-wraps the workspace DEKs with the latest transit key
	 * version (`rewrap`), and with `rotateDataKey` also creates a new active DEK version and
	 * re-seals existing values in the background. Returns how many values were re-sealed.
	 */
	rewrap(workspaceId: string, opts?: { rotateDataKey?: boolean }): Promise<{ resealed: number }>;
}
