import type { ConnectorRow } from './access.ts';
import { upstreamCredential } from './session.ts';
import { openToolsWatch } from './upstream.ts';

/**
 * `tools/list_changed` listeners. For upstreams that advertise `tools.listChanged`, a long-lived
 * connection (a `subscriptions/listen` stream on 2026-07-28, the GET stream on 2025 servers)
 * is opened after a successful sync with the same credential, and closed after `IDLE_MS`
 * (the next session-open refresh reopens it). In-memory, single instance; a restart simply
 * falls back to the 6 h cache + session-open refresh.
 */

export const IDLE_MS = 6 * 60 * 60 * 1000;

type Watch = { close: () => Promise<void>; timer: ReturnType<typeof setTimeout> };

const watches = new Map<string, Watch>();
const opening = new Set<string>();

export const isWatching = (connectorId: string) => watches.has(connectorId);

export async function ensureWatch(
	conn: ConnectorRow,
	credentialUserId: string | null,
	onChanged: () => void
): Promise<void> {
	if (!conn.toolsListChanged || conn.suspendedAt || watches.has(conn.id) || opening.has(conn.id))
		return;
	opening.add(conn.id);
	try {
		const credential = await upstreamCredential(conn, credentialUserId);
		if (credential === 'missing') return;
		const handle = await openToolsWatch({ url: conn.url, credential, onChanged });
		const timer = setTimeout(() => void stopWatch(conn.id), IDLE_MS);
		timer.unref?.();
		watches.set(conn.id, { close: handle.close, timer });
		void handle.closed.then(() => {
			const current = watches.get(conn.id);
			if (current?.close === handle.close) {
				clearTimeout(current.timer);
				watches.delete(conn.id);
			}
		});
	} catch {
		// Best effort: refresh still happens on session open and on call errors
	} finally {
		opening.delete(conn.id);
	}
}

export async function stopWatch(connectorId: string): Promise<void> {
	const watch = watches.get(connectorId);
	if (!watch) return;
	watches.delete(connectorId);
	clearTimeout(watch.timer);
	await watch.close();
}

export async function stopAllWatches(): Promise<void> {
	await Promise.all([...watches.keys()].map(stopWatch));
}
