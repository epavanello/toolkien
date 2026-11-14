import { toast } from 'svelte-sonner';
import type {
	ConnectorAuthType,
	ConnectorSummary,
	SyncResult
} from '#lib/server/connectors/types.ts';

/** Who uses the connector's credential, in words */
export const audienceLabel = (c: Pick<ConnectorSummary, 'ownerUserId' | 'scope'>) =>
	c.ownerUserId
		? 'Only me'
		: c.scope === 'shared'
			? 'Everyone (shared account)'
			: 'Each member (own account)';

export const authLabel = (type: ConnectorAuthType) =>
	type === 'oauth' ? 'OAuth' : type === 'token' ? 'Token / API key' : 'None';

type AccessFields = Pick<
	ConnectorSummary,
	'authType' | 'authenticated' | 'canAuthenticate' | 'suspended' | 'status'
>;

/** "Your access" as a status value: the viewer's real credential state */
export const accessStatus = (c: AccessFields) =>
	c.authenticated ? (c.authType === 'none' ? 'not_required' : 'connected') : 'not_connected';

/** The viewer can and must sign in before agents can use the connector */
export const needsSignIn = (c: AccessFields) =>
	!c.suspended && !c.authenticated && c.canAuthenticate && c.authType !== 'none';

/** Label of the primary sign-in action */
export const signInLabel = (c: Pick<ConnectorSummary, 'authType' | 'authenticated'>) =>
	c.authType === 'token'
		? c.authenticated
			? 'Replace token'
			: 'Add token'
		: c.authenticated
			? 'Reconnect'
			: 'Connect';

/** Toast after a manual refresh; changed signatures and descriptions are warnings */
export function describeSync(result: SyncResult) {
	const changes = [
		result.added && `${result.added} added`,
		result.updated && `${result.updated} updated`,
		result.removed && `${result.removed} removed`
	].filter(Boolean);
	const summary = changes.length > 0 ? changes.join(', ') : 'No changes';
	if (result.signatureChanged.length > 0 || result.descriptionChanged.length > 0) {
		toast.warning(`Tools refreshed: ${summary}`, {
			description: [
				result.signatureChanged.length > 0 &&
					`Signature changed: ${result.signatureChanged.join(', ')} (permissions to confirm).`,
				result.descriptionChanged.length > 0 &&
					`Description changed: ${result.descriptionChanged.join(', ')}. Review before trusting.`
			]
				.filter(Boolean)
				.join(' ')
		});
	} else {
		toast.success(`Tools refreshed: ${summary}`);
	}
}

/** Directory check level, in words */
export const checkLabel = (status: 'tested' | 'documented' | 'needs-review') =>
	status === 'tested'
		? 'Tested (tool list inspected)'
		: status === 'documented'
			? "Documented (endpoint in the vendor's docs)"
			: 'Needs review';

/** Why agents see this connector's descriptions flagged as untrusted */
export const untrustedReason = (
	c: Pick<ConnectorSummary, 'publisher' | 'needsReview' | 'name'>
) =>
	`${
		c.publisher === null
			? 'This server is not in the directory'
			: c.publisher === 'community'
				? `This server is maintained by a third party, not by ${c.name}`
				: 'Its directory entry still needs review'
	}: agents see its tool descriptions flagged as untrusted, and you confirm each tool's permission.`;
