/**
 * AES-256-GCM primitives over WebCrypto. Keys are imported non-extractable, so once a DEK is
 * unwrapped and imported its raw bytes can be dropped and never leave the CryptoKey.
 */

const subtle = globalThis.crypto.subtle;
const encoder = new TextEncoder();

export const NONCE_BYTES = 12;
export const KEY_BYTES = 32;

/** WebCrypto wants an ArrayBuffer-backed view; DB drivers hand back Buffers on shared pools */
const view = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

export const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
	if (raw.byteLength !== KEY_BYTES) throw new Error('AES-256 keys are 32 bytes');
	return subtle.importKey('raw', view(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function aesGcmSeal(
	key: CryptoKey,
	plaintext: Uint8Array,
	aad: string
): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
	const nonce = randomBytes(NONCE_BYTES);
	const ciphertext = await subtle.encrypt(
		{ name: 'AES-GCM', iv: nonce, additionalData: encoder.encode(aad), tagLength: 128 },
		key,
		view(plaintext)
	);
	return { ciphertext: new Uint8Array(ciphertext), nonce };
}

/** Throws a content-free error when the tag, nonce or associated data do not match */
export async function aesGcmOpen(
	key: CryptoKey,
	ciphertext: Uint8Array,
	nonce: Uint8Array,
	aad: string
): Promise<Uint8Array> {
	try {
		const plaintext = await subtle.decrypt(
			{ name: 'AES-GCM', iv: view(nonce), additionalData: encoder.encode(aad), tagLength: 128 },
			key,
			view(ciphertext)
		);
		return new Uint8Array(plaintext);
	} catch {
		throw new CryptoError('Could not open sealed value');
	}
}

/** HKDF-SHA256 → AES-256-GCM key (development master key derivation) */
export async function deriveAesKey(master: Uint8Array, salt: string, info: string) {
	const base = await subtle.importKey('raw', view(master), 'HKDF', false, ['deriveKey']);
	return subtle.deriveKey(
		{ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode(salt), info: encoder.encode(info) },
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

/** Errors of this module never carry plaintext, keys, ciphertext or upstream bodies */
export class CryptoError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CryptoError';
	}
}

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
export const fromBase64 = (text: string) => new Uint8Array(Buffer.from(text, 'base64'));
