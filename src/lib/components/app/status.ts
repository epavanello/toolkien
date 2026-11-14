/**
 * Semantic tones shared by every status-like display. Pages pass raw domain values
 * (`completed`, `pending_auth`, …); the mapping to colors lives here, once.
 */
export type Tone = 'success' | 'pending' | 'error' | 'neutral';

const TONES: Record<string, Tone> = {
	// executions / calls / approvals / audit outcomes
	completed: 'success',
	success: 'success',
	approved: 'success',
	running: 'pending',
	paused: 'pending',
	pending: 'pending',
	awaiting_approval: 'pending',
	failed: 'error',
	failure: 'error',
	rejected: 'error',
	denied: 'error',
	blocked: 'error',
	cancelled: 'neutral',
	expired: 'neutral',
	// connectors
	active: 'success',
	pending_auth: 'pending',
	error: 'error',
	disabled: 'neutral',
	suspended: 'error',
	// connector auth (per viewer) and directory verification
	connected: 'success',
	not_connected: 'pending',
	not_required: 'neutral',
	verified: 'success',
	community: 'neutral',
	unverified: 'pending',
	official: 'success',
	tested: 'success',
	documented: 'success',
	'needs-review': 'pending',
	// members (passkey), invite links, kill switches
	missing: 'pending',
	used: 'neutral',
	revoked: 'neutral',
	released: 'neutral'
};

export const toneFor = (status: string): Tone => TONES[status] ?? 'neutral';

/** `pending_auth` → `Pending auth` */
export const humanize = (value: string) => {
	const text = value.replace(/[_.-]+/g, ' ').trim();
	return text.charAt(0).toUpperCase() + text.slice(1);
};
