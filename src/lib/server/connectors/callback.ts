import { error } from '@sveltejs/kit';
import { safeRedirectPath } from '#lib/core/redirects.ts';
import type { OAuthResult } from './types.ts';

/**
 * The upstream OAuth callback (`/connectors/oauth/callback`) as a function of its query, so every
 * outcome is testable without HTTP.
 *
 * - Whenever the flow is known (its `state` matches a flow of this user) the browser goes back to
 *   the flow's `returnTo` (the connectors page with `?connector=<id>`) plus `oauth=<code>`, and
 *   the page explains the outcome with a retry.
 * - Only when nothing is recoverable (no state, unknown or reused state, another account's flow,
 *   no longer a member) the request fails with a 4xx whose message the error page shows.
 * - Codes are the only detail that leaves this function: never tokens, codes, or the provider's
 *   `error_description`/`error_uri` (mix-up attacks, log hygiene).
 */

/** A failure after the flow was identified: the user can go back to the connector and retry */
export class OAuthCallbackError extends Error {
	constructor(
		readonly code: Exclude<OAuthResult, 'connected'>,
		readonly returnTo: string
	) {
		super(`Upstream OAuth failed: ${code}`);
		this.name = 'OAuthCallbackError';
	}
}

export type OAuthCallbackDeps = {
	/** `ConnectorsService.completeOAuth`; recoverable failures throw `OAuthCallbackError` */
	complete: (
		state: string,
		code: string,
		opts: { userId: string; iss?: string }
	) => Promise<{ returnTo: string }>;
	/** Drops the user's flow for `state`; its `returnTo`, or `null` when there is none */
	abandon: (state: string, userId: string) => Promise<string | null>;
	/** Short code only */
	log?: (code: Exclude<OAuthResult, 'connected'>) => void;
};

const UNKNOWN_FLOW =
	'This sign-in link expired or was already used. Open Connectors and choose Connect again.';

/** `returnTo` with `oauth=<code>` added (any previous `oauth` value replaced) */
export function withOAuthResult(returnTo: string, code: OAuthResult): string {
	const url = new URL(safeRedirectPath(returnTo), 'http://localhost');
	url.searchParams.set('oauth', code);
	return `${url.pathname}${url.search}${url.hash}`;
}

/** Where the callback sends the browser; throws an HTTP error when nothing is recoverable */
export async function handleOAuthCallback(
	params: URLSearchParams,
	userId: string,
	deps: OAuthCallbackDeps
): Promise<string> {
	const state = params.get('state') ?? '';
	if (!state) {
		error(400, 'This sign-in link is incomplete. Open Connectors and choose Connect again.', {
			code: 'INVALID_INPUT'
		});
	}
	const code = params.get('code');
	if (!code) {
		const providerError = params.get('error');
		const result = providerError === 'access_denied' ? 'denied' : 'provider_error';
		const returnTo = await deps.abandon(state, userId);
		deps.log?.(result);
		if (returnTo === null) error(400, UNKNOWN_FLOW, { code: 'INVALID_INPUT' });
		return withOAuthResult(returnTo, result);
	}
	try {
		const done = await deps.complete(state, code, {
			userId,
			iss: params.get('iss') ?? undefined
		});
		return withOAuthResult(done.returnTo, 'connected');
	} catch (cause) {
		if (!(cause instanceof OAuthCallbackError)) throw cause;
		deps.log?.(cause.code);
		return withOAuthResult(cause.returnTo, cause.code);
	}
}
