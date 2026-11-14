import { PLAUSIBLE_DOMAIN, PLAUSIBLE_URL } from '$app/env/private';

/**
 * Optional, cookieless page analytics through a self-hosted Plausible, proxied first-party:
 * the browser loads `/a/script.js` and posts to `/a/event` on our origin (no CSP change, no
 * third-party request from the browser). The proxy rewrites every URL before forwarding, so
 * workspace slugs, invite tokens, approval ids and query strings (magic-link tokens, OAuth codes)
 * never reach Plausible. Off unless both `PLAUSIBLE_URL` and `PLAUSIBLE_DOMAIN` are set.
 */
export const analyticsEnabled = () => Boolean(PLAUSIBLE_URL && PLAUSIBLE_DOMAIN);

export const SCRIPT_PATH = '/a/script.js';
export const EVENT_PATH = '/a/event';

/** Path segments that identify a person, a workspace or a secret: replaced by a placeholder */
const REDACTIONS: [RegExp, string][] = [
	[/^\/w\/[^/]+/, '/w/:workspace'],
	[/^\/invite\/[^/]+/, '/invite/:token'],
	[/^\/approve\/[^/]+/, '/approve/:id'],
	[/^\/connectors\/(?!icon\/)[^/]+\/.+/, '/connectors/:callback'],
	[/^\/connectors\/icon\/[^/]+/, '/connectors/icon/:id'],
	[/^\/admin\/.+/, '/admin/:section']
];

/** Campaign parameters are the only query values worth keeping */
const KEPT_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'];

/**
 * Rewrites a page URL for analytics: same origin only, redacted path, campaign parameters only.
 * Returns `null` for anything that is not one of our pages.
 */
export function sanitizePageUrl(raw: unknown, origin: string): string | null {
	if (typeof raw !== 'string' || raw.length > 2048) return null;
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return null;
	}
	if (url.origin !== origin) return null;
	let path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/';
	for (const [pattern, replacement] of REDACTIONS) {
		if (pattern.test(path)) {
			path = path.replace(pattern, replacement);
			break;
		}
	}
	const clean = new URL(path, origin);
	for (const key of KEPT_PARAMS) {
		const value = url.searchParams.get(key);
		if (value) clean.searchParams.set(key, value.slice(0, 100));
	}
	return clean.toString();
}

/** External referrers are kept as their origin only; our own pages are dropped */
export function sanitizeReferrer(raw: unknown, origin: string): string | null {
	if (typeof raw !== 'string' || !raw) return null;
	try {
		const url = new URL(raw);
		if (url.origin === origin || !/^https?:$/.test(url.protocol)) return null;
		return `${url.origin}/`;
	} catch {
		return null;
	}
}

/** What Plausible's tracker posts; anything else it sends (domain, props) is ignored */
type IncomingEvent = { n?: unknown; u?: unknown; r?: unknown; p?: unknown; [key: string]: unknown };

/**
 * Builds the body forwarded to Plausible from what the browser script sent, or `null` to drop
 * it. Only pageviews and outbound-link clicks go through; custom props are discarded.
 */
export function buildEvent(input: IncomingEvent, origin: string) {
	const name = input.n === 'pageview' || input.n === 'Outbound Link: Click' ? input.n : null;
	const url = sanitizePageUrl(input.u, origin);
	if (!name || !url || !PLAUSIBLE_DOMAIN) return null;
	const body: Record<string, unknown> = {
		n: name,
		u: url,
		d: PLAUSIBLE_DOMAIN,
		r: sanitizeReferrer(input.r, origin)
	};
	// Outbound clicks carry the destination: keep its origin only
	if (name === 'Outbound Link: Click' && input.p && typeof input.p === 'object') {
		const target = sanitizeReferrer((input.p as { url?: unknown }).url, origin);
		if (target) body.p = { url: target };
	}
	return body;
}

let cachedScript: { body: string; at: number } | undefined;
const SCRIPT_TTL_MS = 6 * 60 * 60 * 1000;

/** Plausible's tracker (auto pageviews + outbound links), cached in memory */
export async function trackerScript(): Promise<string | null> {
	if (!analyticsEnabled()) return null;
	if (cachedScript && Date.now() - cachedScript.at < SCRIPT_TTL_MS) return cachedScript.body;
	const response = await fetch(`${PLAUSIBLE_URL}/js/script.outbound-links.js`, {
		signal: AbortSignal.timeout(5000)
	});
	if (!response.ok) return cachedScript?.body ?? null;
	cachedScript = { body: await response.text(), at: Date.now() };
	return cachedScript.body;
}

/** Forwards one event; the client IP and user agent let Plausible count unique visitors */
export async function forwardEvent(
	body: Record<string, unknown>,
	client: { ip: string; userAgent: string }
) {
	const response = await fetch(`${PLAUSIBLE_URL}/api/event`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'User-Agent': client.userAgent.slice(0, 512),
			'X-Forwarded-For': client.ip
		},
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(5000)
	});
	return response.status;
}

/** The tag added to every HTML page when analytics is on (same-origin script: no CSP change) */
export const trackerTag = () =>
	`<script defer data-domain="${PLAUSIBLE_DOMAIN}" data-api="${EVENT_PATH}" src="${SCRIPT_PATH}"></script>`;
