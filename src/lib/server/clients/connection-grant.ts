/**
 * Ties one OAuth grant to one MCP connection (`mcp_connection.id`), with no dependency so the
 * auth config can import it.
 *
 * The provider asks for a consent `reference_id` (`postLogin.consentReferenceId`) when it looks
 * the consent up and when it issues the code. The consent screen runs "Allow" inside
 * `withConnectionGrant(id, …)`, so both see the new connection's id: the consent, the code and
 * every refresh token of the grant carry it, and `connectionClaims` stamps it on each access
 * token. Outside that scope there is no reference, no stored consent matches (each one has a
 * reference), and the provider always shows the consent screen: every approval is a new
 * connection.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

/** Access-token claim naming the connection */
export const CONNECTION_CLAIM = 'connection_id';

const grant = new AsyncLocalStorage<string>();

export const withConnectionGrant = <T>(connectionId: string, run: () => Promise<T>): Promise<T> =>
	grant.run(connectionId, run);

/** `postLogin.consentReferenceId`: the connection being approved, if any */
export const consentReferenceId = (): string | undefined => grant.getStore();

/** `customAccessTokenClaims`: the grant's reference, carried through refresh rotation */
export const connectionClaims = ({ referenceId }: { referenceId?: string }) =>
	referenceId ? { [CONNECTION_CLAIM]: referenceId } : {};
