import { isHttpError } from '@sveltejs/kit';

export const UNEXPECTED_ERROR = 'Something went wrong. Please try again.';

/**
 * 4xx remote `error()` bodies are already user-facing; 5xx and unknown errors use the fallback,
 * so internals never reach the UI. Accepts both a thrown HttpError and the plain `App.Error`
 * body a `<svelte:boundary>` receives.
 */
export function remoteErrorMessage(err: unknown, fallback = UNEXPECTED_ERROR): string {
	const { status, message } = isHttpError(err)
		? { status: err.status, message: err.body.message }
		: ((err ?? {}) as { status?: number; message?: string });
	return status && status < 500 && message?.trim() ? message.trim() : fallback;
}
