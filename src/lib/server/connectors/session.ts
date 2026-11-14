import type { ConnectorRow } from './access.ts';
import { findCredential, openCredential, saveCredential } from './credentials.ts';
import { REFRESH_SKEW_MS, refreshUpstreamTokens } from './oauth.ts';
import type { UpstreamCredential } from './upstream.ts';

/**
 * The credential to send upstream for `credentialUserId` (`null` = shared): decrypted in
 * memory, OAuth access tokens refreshed ahead of expiry (or on demand after a 401).
 * `'missing'` = nothing usable: the user must (re)connect.
 */
export async function upstreamCredential(
	conn: ConnectorRow,
	credentialUserId: string | null,
	opts: { forceRefresh?: boolean } = {}
): Promise<UpstreamCredential | 'missing'> {
	if (conn.authType === 'none') return null;
	const row = await findCredential(conn.id, credentialUserId);
	if (!row) return 'missing';
	const secret = await openCredential(row);
	if ('token' in secret) return { token: secret.token };

	const expiresSoon =
		row.expiresAt !== null && row.expiresAt.getTime() - Date.now() < REFRESH_SKEW_MS;
	if (opts.forceRefresh || expiresSoon) {
		const refreshed = await refreshUpstreamTokens(conn, secret);
		if (refreshed) {
			await saveCredential(conn, credentialUserId, 'oauth', refreshed.secret, {
				scope: refreshed.scope ?? row.scope,
				expiresAt: refreshed.expiresAt
			});
			return { token: refreshed.secret.accessToken };
		}
		const expired = row.expiresAt !== null && row.expiresAt.getTime() <= Date.now();
		if (opts.forceRefresh || expired) return 'missing';
	}
	return { token: secret.accessToken };
}

/** Whether a usable credential exists (no decryption): drives `authenticated` and discovery */
export async function hasCredential(conn: ConnectorRow, credentialUserId: string | null) {
	return conn.authType === 'none' || (await findCredential(conn.id, credentialUserId)) !== null;
}
