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
