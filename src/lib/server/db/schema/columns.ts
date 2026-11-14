import { sql } from 'drizzle-orm';
import { blob, customType, integer, text } from 'drizzle-orm/sqlite-core';

/** Random UUID primary key, generated in the app so ids are known before the insert */
export const id = () =>
	text('id')
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

/** Millisecond timestamps, same storage as the Better Auth tables */
export const timestamp = (name: string) => integer(name, { mode: 'timestamp_ms' });

/** Insert time; pass a name for other "set once at insert" instants (`started_at`, …) */
export const createdAt = (name = 'created_at') =>
	timestamp(name)
		.notNull()
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`);

export const updatedAt = () =>
	timestamp('updated_at')
		.notNull()
		.default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
		.$onUpdate(() => new Date());

/** JSON stored as text; `T` documents the shape, nothing validates it on read */
export const json = <T>(name: string) =>
	customType<{ data: T; driverData: string }>({
		dataType: () => 'text',
		toDriver: (value) => JSON.stringify(value),
		fromDriver: (value) => JSON.parse(value) as T
	})(name);

/**
 * The three columns of an AES-256-GCM envelope produced by `#lib/server/crypto`: ciphertext,
 * 12-byte nonce and the version of the workspace data key that sealed it. The workspace id is
 * the associated data, so a row copied to another workspace no longer decrypts.
 *
 * `sealed('secret')` gives `secretCiphertext`, `secretNonce`, `secretKeyVersion`
 * (`secret_ciphertext`, `secret_nonce`, `secret_key_version`), all nullable: a sealed value is
 * often written after the row exists and wiped when it is no longer needed.
 */
export const sealed = <P extends string>(prefix: P) => {
	const snake = prefix.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
	return {
		[`${prefix}Ciphertext`]: blob(`${snake}_ciphertext`, { mode: 'buffer' }),
		[`${prefix}Nonce`]: blob(`${snake}_nonce`, { mode: 'buffer' }),
		[`${prefix}KeyVersion`]: integer(`${snake}_key_version`)
	} as {
		[K in `${P}Ciphertext` | `${P}Nonce`]: ReturnType<typeof _sealedBlob>;
	} & { [K in `${P}KeyVersion`]: ReturnType<typeof _sealedVersion> };
};

// Only used for their types (the column builder types of `sealed`)
const _sealedBlob = () => blob('', { mode: 'buffer' });
const _sealedVersion = () => integer('');
