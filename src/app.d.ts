import type { ErrorCode } from '#lib/core/errors.ts';
import type { AuthSession } from '#lib/server/auth.ts';

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Error {
			code: ErrorCode;
			message: string;
			/** Reference of an unexpected (5xx) error, logged server side with the same id */
			id?: string;
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
