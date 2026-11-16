import { toast } from 'svelte-sonner';
import type { SecondaryTime } from '#lib/components/app/index.ts';
import type {
	ConnectorAuthType,
	ConnectorSummary,
	OAuthResult,
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

/**
 * What a sync changed, in words: `changes` ("1 added, 4 updated" or "No changes") and the
 * tools to look at (`details`, a warning when set). One wording for the Refresh toast and the
 * notice of changes found in the background.
 */
export function syncSummary(result: SyncResult) {
	const changes = [
		result.added && `${result.added} added`,
		result.updated && `${result.updated} updated`,
		result.removed && `${result.removed} removed`
	].filter(Boolean);
	const details = [
		result.signatureChanged.length > 0 &&
			`Signature changed: ${result.signatureChanged.join(', ')} (permissions to confirm).`,
		result.descriptionChanged.length > 0 &&
			`Description changed: ${result.descriptionChanged.join(', ')}. Review before trusting.`
	].filter(Boolean);
	return {
		changes: changes.length > 0 ? changes.join(', ') : 'No changes',
		details: details.length > 0 ? details.join(' ') : null
	};
}

/** Toast after a manual refresh; changed signatures and descriptions are warnings */
export function describeSync(result: SyncResult) {
	const { changes, details } = syncSummary(result);
	if (details) toast.warning(`Tools refreshed: ${changes}`, { description: details });
	else toast.success(`Tools refreshed: ${changes}`);
}

/**
 * The last check, shown after "Tools updated" (the last change): a check that found nothing
 * is not news (`3 days ago · checked 2 h ago`)
 */
export const lastCheck = (c: Pick<ConnectorSummary, 'lastSyncedAt'>): SecondaryTime => ({
	label: 'checked',
	value: c.lastSyncedAt
});

/** Directory check level, in words */
export const checkLabel = (status: 'tested' | 'documented' | 'needs-review') =>
	status === 'tested'
		? 'Tested (tool list inspected)'
		: status === 'documented'
			? "Documented (endpoint in the vendor's docs)"
			: 'Needs review';

/** Why agents see this connector's descriptions flagged as untrusted */
export const untrustedReason = (c: Pick<ConnectorSummary, 'publisher' | 'needsReview' | 'name'>) =>
	`${
		c.publisher === null
			? 'This server is not in the directory'
			: c.publisher === 'community'
				? `This server is maintained by a third party, not by ${c.name}`
				: 'Its directory entry still needs review'
	}: agents see its tool descriptions flagged as untrusted, and you confirm each tool's permission.`;

export type OAuthNotice = {
	tone: 'success' | 'warning' | 'danger';
	title: string;
	description: string;
	/** Label of the button that starts the sign-in again, when it makes sense */
	action: 'Connect' | 'Try again' | null;
};

const OAUTH_NOTICES: Record<OAuthResult, OAuthNotice> = {
	connected: {
		tone: 'success',
		title: 'Connected',
		description: 'You are signed in and the tool list was loaded. Agents can use it now.',
		action: null
	},
	denied: {
		tone: 'warning',
		title: 'Sign-in cancelled',
		description: 'You cancelled at the provider, so nothing was connected.',
		action: 'Connect'
	},
	provider_error: {
		tone: 'warning',
		title: 'The provider did not complete the sign-in',
		description:
			'It answered with an error instead of an authorization. Try again; if it keeps failing, check that your account there has access.',
		action: 'Try again'
	},
	expired: {
		tone: 'warning',
		title: 'The sign-in took too long',
		description: 'A sign-in link is valid for 10 minutes. Start it again to connect.',
		action: 'Try again'
	},
	exchange_failed: {
		tone: 'danger',
		title: 'The provider refused the sign-in',
		description:
			'Toolkien could not exchange the authorization for access. Try again; if it keeps failing, the server may only accept a pasted token.',
		action: 'Try again'
	},
	unreachable: {
		tone: 'danger',
		title: 'The sign-in server did not respond',
		description:
			"Toolkien could not reach the provider's authorization server. It may be down: try again in a moment.",
		action: 'Try again'
	},
	removed: {
		tone: 'warning',
		title: 'Connector removed',
		description: 'The connector was deleted while you were signing in. Nothing was connected.',
		action: null
	},
	failed: {
		tone: 'danger',
		title: 'The sign-in could not be completed',
		description: "The connector's sign-in setup changed while you were away. Start it again.",
		action: 'Try again'
	}
};

/** What the page says after the upstream sign-in (`?oauth=<code>`); unknown codes say nothing */
export const oauthNotice = (code: string | null): OAuthNotice | null =>
	code !== null && Object.hasOwn(OAUTH_NOTICES, code) ? OAUTH_NOTICES[code as OAuthResult] : null;
