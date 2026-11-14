import { error } from '@sveltejs/kit';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { connector, connectorIcon } from '#lib/server/db/schema/index.ts';
import { safeFetch, type SafeFetch } from '#lib/server/net/index.ts';
import { getById } from '#lib/server/workspaces/index.ts';
import type { ConnectorRow } from './access.ts';
import { getDirectoryEntry } from './directory.ts';

/**
 * Favicons of free-URL connectors. The server's origin is untrusted: every request goes through
 * `safeFetch` (SSRF rules), bodies are capped, and only raster images recognised from their
 * bytes are kept (never SVG, never the declared content type). Directory connectors use the
 * committed directory icon instead, and nothing is fetched for them.
 */

export const ICON_MAX_BYTES = 64 * 1024;
const HTML_MAX_BYTES = 256 * 1024;
/** Whole lookup budget (homepage + a few candidates), so adding a connector never waits long */
const LOOKUP_TIMEOUT_MS = 8_000;
const MAX_REQUESTS = 8;
/** A found icon is fetched again after this; a miss is retried sooner */
const REFRESH_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const RETRY_MISS_AFTER_MS = 24 * 60 * 60 * 1000;

export type IconImage = { contentType: string; data: Uint8Array };

const startsWith = (bytes: Uint8Array, prefix: number[], offset = 0) =>
	bytes.byteLength >= offset + prefix.length && prefix.every((b, i) => bytes[offset + i] === b);
const ascii = (value: string) => [...value].map((c) => c.charCodeAt(0));

/** Content type of a raster image recognised from its first bytes; `null` for anything else */
export function sniffRaster(bytes: Uint8Array): string | null {
	if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
	if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) return 'image/x-icon';
	if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
	if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
	if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
	return null;
}

const attribute = (tag: string, name: string) =>
	new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
		.exec(tag)
		?.slice(1)
		.find((value) => value !== undefined);

/**
 * Icon URLs declared by a page (`<link rel="icon" | "apple-touch-icon" …>`), best first:
 * apple-touch icons (square, large), then the biggest declared size. SVG and `data:` links are
 * skipped (only raster images are accepted anyway).
 */
export function iconLinks(html: string, base: URL): URL[] {
	const found: { url: URL; score: number }[] = [];
	for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
		const rel = attribute(tag, 'rel')?.toLowerCase().split(/\s+/) ?? [];
		if (!rel.includes('icon') && !rel.includes('apple-touch-icon')) continue;
		const href = attribute(tag, 'href')?.replace(/&amp;/g, '&').trim();
		const type = attribute(tag, 'type')?.toLowerCase() ?? '';
		if (!href || href.startsWith('data:') || type.includes('svg')) continue;
		let url: URL;
		try {
			url = new URL(href, base);
		} catch {
			continue;
		}
		if (url.protocol !== 'https:' || /\.svgz?$/i.test(url.pathname)) continue;
		const size = Math.max(
			0,
			...(attribute(tag, 'sizes') ?? '').split(/\s+/).map((s) => Number(s.split('x')[0]) || 0)
		);
		found.push({ url, score: (rel.includes('apple-touch-icon') ? 1000 : 0) + Math.min(size, 512) });
	}
	return found.sort((a, b) => b.score - a.score).map((item) => item.url);
}

const PUBLIC_SUFFIX_LIKE = /^(?:co|com|net|org|gov|edu|ac|or|ne|go)\.[a-z]{2}$/;

/** Where the service's site likely lives: the server's origin, then its parent domain */
export function iconOrigins(serverUrl: string): URL[] {
	const url = new URL(serverUrl);
	const origins = [new URL(url.origin)];
	const labels = url.hostname.split('.');
	const parent = labels.slice(1).join('.');
	if (labels.length >= 3 && !/^\d+$/.test(labels.at(-1)!) && !PUBLIC_SUFFIX_LIKE.test(parent)) {
		origins.push(new URL(`https://${parent}`));
	}
	return origins;
}

/**
 * Looks for the favicon of an MCP server's service: for its origin and parent domain, the icons
 * the homepage declares, then `/apple-touch-icon.png` and `/favicon.ico`. Returns the first
 * raster image within the limits, or `null`. Never throws.
 */
export async function fetchFavicon(
	serverUrl: string,
	fetcher: SafeFetch = safeFetch
): Promise<IconImage | null> {
	const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
	let requests = 0;
	const get = async (url: URL, maxResponseBytes: number, accept: string) => {
		if (requests++ >= MAX_REQUESTS || signal.aborted) return null;
		try {
			const response = await fetcher(url, {
				headers: { accept },
				maxRedirects: 3,
				maxResponseBytes,
				timeoutMs: 4_000,
				signal
			});
			if (!response.ok) {
				await response.body?.cancel();
				return null;
			}
			return response;
		} catch {
			return null;
		}
	};
	const tried = new Set<string>();
	try {
		for (const origin of iconOrigins(serverUrl)) {
			let declared: URL[] = [];
			const page = await get(origin, HTML_MAX_BYTES, 'text/html');
			if (page && (page.headers.get('content-type') ?? '').includes('html')) {
				const html = await page.text().catch(() => '');
				declared = iconLinks(html, new URL(page.url || origin.href));
			} else {
				await page?.body?.cancel().catch(() => undefined);
			}
			const candidates = [
				...declared.slice(0, 2),
				new URL('/apple-touch-icon.png', origin),
				new URL('/favicon.ico', origin)
			];
			for (const candidate of candidates) {
				if (tried.has(candidate.href)) continue;
				tried.add(candidate.href);
				const response = await get(candidate, ICON_MAX_BYTES, 'image/*');
				if (!response) continue;
				const data = new Uint8Array(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
				const contentType = data.byteLength > 0 ? sniffRaster(data) : null;
				if (contentType && data.byteLength <= ICON_MAX_BYTES) return { contentType, data };
			}
		}
	} catch {
		// Best effort: the UI falls back to a monogram
	}
	return null;
}

/** Whether this connector gets its logo from the directory (nothing to fetch) */
const hasDirectoryIcon = (row: Pick<ConnectorRow, 'source' | 'directoryId'>) =>
	row.source === 'directory' && Boolean(getDirectoryEntry(row.directoryId)?.icon);

/**
 * Fetches and stores the favicon of a free-URL connector when it has none yet, or the stored one
 * (or miss) is old. Best effort: never throws, so adding or syncing never fails because of it.
 */
export async function refreshConnectorIcon(
	row: Pick<ConnectorRow, 'id' | 'url' | 'source' | 'directoryId'>,
	fetcher: SafeFetch = safeFetch,
	now = new Date()
): Promise<void> {
	try {
		if (hasDirectoryIcon(row)) return;
		const [stored] = await db
			.select({ data: connectorIcon.data, fetchedAt: connectorIcon.fetchedAt })
			.from(connectorIcon)
			.where(eq(connectorIcon.connectorId, row.id))
			.limit(1);
		const age = stored ? now.getTime() - stored.fetchedAt.getTime() : Infinity;
		if (age < (stored?.data ? REFRESH_AFTER_MS : RETRY_MISS_AFTER_MS)) return;
		const icon = await fetchFavicon(row.url, fetcher);
		// Keep a previously found icon when a later lookup misses
		if (!icon && stored?.data) {
			await db
				.update(connectorIcon)
				.set({ fetchedAt: now })
				.where(eq(connectorIcon.connectorId, row.id));
			return;
		}
		const values = {
			contentType: icon?.contentType ?? null,
			data: icon ? Buffer.from(icon.data) : null,
			fetchedAt: now
		};
		await db
			.insert(connectorIcon)
			.values({ connectorId: row.id, ...values })
			.onConflictDoUpdate({ target: connectorIcon.connectorId, set: values });
	} catch {
		// The connector may have been removed meanwhile; the monogram stays
	}
}

/** Version (fetch time) of the stored favicons of these connectors, for cache-busting URLs */
export async function storedIconVersions(connectorIds: string[]): Promise<Map<string, number>> {
	if (connectorIds.length === 0) return new Map();
	const rows = await db
		.select({ connectorId: connectorIcon.connectorId, fetchedAt: connectorIcon.fetchedAt })
		.from(connectorIcon)
		.where(and(inArray(connectorIcon.connectorId, connectorIds), isNotNull(connectorIcon.data)));
	return new Map(rows.map((row) => [row.connectorId, row.fetchedAt.getTime()]));
}

/** Public URL of a connector's logo: directory icon, stored favicon, or `null` (monogram) */
export function connectorIconUrl(
	row: Pick<ConnectorRow, 'id' | 'source' | 'directoryId'>,
	storedVersion: number | undefined
): string | null {
	const entry = row.source === 'directory' ? getDirectoryEntry(row.directoryId) : null;
	if (entry?.icon) return entry.icon;
	return storedVersion === undefined ? null : `/connectors/icon/${row.id}?v=${storedVersion}`;
}

/**
 * The stored favicon of a connector the user can see (member of its workspace; personal
 * connectors only for their owner). 404 otherwise, so ids cannot be probed.
 */
export async function readConnectorIcon(userId: string, connectorId: string): Promise<IconImage> {
	const notFound = () => error(404, 'Icon not found.', { code: 'NOT_FOUND' });
	const [row] = await db
		.select({
			workspaceId: connector.workspaceId,
			ownerUserId: connector.ownerUserId,
			contentType: connectorIcon.contentType,
			data: connectorIcon.data
		})
		.from(connector)
		.innerJoin(connectorIcon, eq(connectorIcon.connectorId, connector.id))
		.where(eq(connector.id, connectorId))
		.limit(1);
	if (!row?.data || !row.contentType) return notFound();
	if (row.ownerUserId !== null && row.ownerUserId !== userId) return notFound();
	if (!(await getById(userId, row.workspaceId))) return notFound();
	// Checked again on the way out: only what `sniffRaster` recognises is ever served
	const data = new Uint8Array(row.data);
	const contentType = sniffRaster(data);
	if (!contentType) return notFound();
	return { contentType, data };
}

/** Logo URLs of these connectors (see `connectorIconUrl`), by connector id */
export async function connectorIcons(
	rows: Pick<ConnectorRow, 'id' | 'source' | 'directoryId'>[]
): Promise<Map<string, string | null>> {
	const stored = await storedIconVersions(rows.filter((r) => r.source === 'url').map((r) => r.id));
	return new Map(rows.map((row) => [row.id, connectorIconUrl(row, stored.get(row.id))]));
}
