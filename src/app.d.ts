import type { ErrorCode } from '#lib/core/errors.ts';
import type { AuthSession } from '#lib/server/auth.ts';

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Error {
			code: ErrorCode;
			message: string;
		}
		interface Locals {
			/** Cookie session user; always null on `/mcp` (bearer tokens only) and when suspended */
			user: AuthSession['user'] | null;
			session: AuthSession['session'] | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
