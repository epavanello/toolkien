import { CryptoError, fromBase64, toBase64 } from './aead.ts';

/**
 * Minimal OpenBao client over `fetch`: AppRole login, short renewable token, and the three
 * transit operations the `app` policy allows (`encrypt`, `decrypt`, `rewrap`) on one derived
 * key. Errors carry the operation and HTTP status only, never request or response bodies.
 */

export type OpenBaoConfig = {
	/** `http://openbao:8200` (internal `core` network) */
	addr: string;
	roleId: string;
	secretId: string;
	/** Derived transit key, e.g. `toolkien-tokens` */
	keyName: string;
	transitMount?: string;
	fetch?: typeof fetch;
	now?: () => number;
	/** Per-request timeout, default 5 s */
	timeoutMs?: number;
};

type Token = { value: string; ttlMs: number; expiresAt: number; renewable: boolean };

type AuthResponse = { auth?: { client_token: string; lease_duration: number; renewable: boolean } };

export class OpenBaoError extends CryptoError {
	readonly operation: string;
	/** HTTP status, 0 for network errors and timeouts */
	readonly status: number;

	constructor(operation: string, status: number) {
		super(`OpenBao ${operation} failed (${status || 'network error'})`);
		this.name = 'OpenBaoError';
		this.operation = operation;
		this.status = status;
	}
}

/** Below this remaining lifetime the token is renewed (fraction of its TTL) */
const RENEW_FRACTION = 1 / 3;
/** A renewal that grants less than this means the token is near its max TTL: log in again */
const MIN_USEFUL_TTL_MS = 60_000;

export class OpenBaoClient {
	#token: Token | undefined;
	#pending: Promise<Token> | undefined;
	readonly #config: Required<Omit<OpenBaoConfig, 'fetch' | 'now'>> & {
		fetch: typeof fetch;
		now: () => number;
	};

	constructor(config: OpenBaoConfig) {
		this.#config = {
			transitMount: 'transit',
			timeoutMs: 5_000,
			fetch: globalThis.fetch.bind(globalThis),
			now: Date.now,
			...config,
			addr: config.addr.replace(/\/+$/, '')
		};
	}

	async #call<T>(operation: string, path: string, body: unknown, token?: string): Promise<T> {
		let response: Response;
		try {
			response = await this.#config.fetch(`${this.#config.addr}/v1/${path}`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					...(token ? { 'x-vault-token': token } : {})
				},
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(this.#config.timeoutMs)
			});
		} catch {
			throw new OpenBaoError(operation, 0);
		}
		if (!response.ok) {
			await response.body?.cancel();
			throw new OpenBaoError(operation, response.status);
		}
		return (await response.json()) as T;
	}

	#fromAuth(operation: string, payload: AuthResponse): Token {
		if (!payload.auth?.client_token) throw new OpenBaoError(operation, 500);
		const ttlMs = payload.auth.lease_duration * 1000;
		return {
			value: payload.auth.client_token,
			ttlMs,
			expiresAt: this.#config.now() + ttlMs,
			renewable: payload.auth.renewable
		};
	}

	async #login(): Promise<Token> {
		const payload = await this.#call<AuthResponse>('login', 'auth/approle/login', {
			role_id: this.#config.roleId,
			secret_id: this.#config.secretId
		});
		return this.#fromAuth('login', payload);
	}

	async #renew(token: Token): Promise<Token> {
		try {
			const payload = await this.#call<AuthResponse>(
				'renew',
				'auth/token/renew-self',
				{},
				token.value
			);
			const renewed = this.#fromAuth('renew', payload);
			if (renewed.ttlMs >= MIN_USEFUL_TTL_MS) return renewed;
		} catch {
			// Fall through to a fresh login
		}
		return this.#login();
	}

	/** A valid token, renewing or logging in as needed; concurrent callers share one request */
	async token(): Promise<string> {
		const current = this.#token;
		const now = this.#config.now();
		if (current && current.expiresAt - now > current.ttlMs * RENEW_FRACTION) return current.value;
		this.#pending ??= (
			current && current.renewable && current.expiresAt - now > 1_000
				? this.#renew(current)
				: this.#login()
		).finally(() => (this.#pending = undefined));
		this.#token = await this.#pending;
		return this.#token.value;
	}

	/** Transit call with one retry after a fresh login when the token was revoked (403) */
	async #transit<T>(operation: 'encrypt' | 'decrypt' | 'rewrap', body: object): Promise<T> {
		const path = `${this.#config.transitMount}/${operation}/${this.#config.keyName}`;
		try {
			return await this.#call<T>(operation, path, body, await this.token());
		} catch (error) {
			if (!(error instanceof OpenBaoError) || error.status !== 403) throw error;
			this.#token = undefined;
			return this.#call<T>(operation, path, body, await this.token());
		}
	}

	/** Derivation context for the derived transit key: the workspace id */
	static context = (workspaceId: string) => toBase64(new TextEncoder().encode(workspaceId));

	async encrypt(workspaceId: string, plaintext: Uint8Array): Promise<string> {
		const result = await this.#transit<{ data: { ciphertext: string } }>('encrypt', {
			plaintext: toBase64(plaintext),
			context: OpenBaoClient.context(workspaceId)
		});
		return result.data.ciphertext;
	}

	async decrypt(workspaceId: string, ciphertext: string): Promise<Uint8Array> {
		const result = await this.#transit<{ data: { plaintext: string } }>('decrypt', {
			ciphertext,
			context: OpenBaoClient.context(workspaceId)
		});
		return fromBase64(result.data.plaintext);
	}

	/** Re-encrypts with the latest transit key version without exposing the plaintext */
	async rewrap(workspaceId: string, ciphertext: string): Promise<string> {
		const result = await this.#transit<{ data: { ciphertext: string } }>('rewrap', {
			ciphertext,
			context: OpenBaoClient.context(workspaceId)
		});
		return result.data.ciphertext;
	}
}
