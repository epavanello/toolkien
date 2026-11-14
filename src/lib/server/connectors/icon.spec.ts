import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({ ORIGIN: 'https://toolkien.test', EGRESS_PROXY_URL: '' }));
vi.mock('$app/env', () => ({ building: false, dev: false }));
vi.mock('#lib/server/db/index.ts', async () => {
	const { createConnectorsTestDb } = await import('./testing/db.ts');
	return { db: await createConnectorsTestDb() };
});
vi.mock('#lib/server/workspaces/index.ts', () => ({
	getById: async (userId: string, workspaceId: string) =>
		['alice', 'bob'].includes(userId) ? { id: workspaceId, role: 'member' } : null
}));

import { db } from '#lib/server/db/index.ts';
import { connector, connectorIcon } from '#lib/server/db/schema/index.ts';
import { eq } from 'drizzle-orm';
import {
	connectorIconUrl,
	fetchFavicon,
	iconLinks,
	iconOrigins,
	ICON_MAX_BYTES,
	readConnectorIcon,
	refreshConnectorIcon,
	sniffRaster,
	storedIconVersions
} from './icon.ts';
import { seedWorkspace } from './testing/db.ts';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const ICO = new Uint8Array([0, 0, 1, 0, 1, 0, 16, 16]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');

type Route = { status?: number; type?: string; body: string | Uint8Array };

/** A fake `safeFetch` serving fixed routes by URL; records every request */
function fakeFetch(routes: Record<string, Route>) {
	const requested: string[] = [];
	const fetcher = vi.fn(async (input: string | URL) => {
		const url = String(input);
		requested.push(url);
		const route = routes[url];
		if (!route) return new Response('not found', { status: 404 });
		return new Response(route.body as BodyInit, {
			status: route.status ?? 200,
			headers: { 'content-type': route.type ?? 'application/octet-stream' }
		});
	});
	return { fetcher, requested };
}

describe('sniffRaster', () => {
	it('recognises raster images from their bytes, never SVG or HTML', () => {
		expect(sniffRaster(PNG)).toBe('image/png');
		expect(sniffRaster(ICO)).toBe('image/x-icon');
		expect(sniffRaster(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
		expect(sniffRaster(new TextEncoder().encode('GIF89a...'))).toBe('image/gif');
		expect(sniffRaster(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
		expect(sniffRaster(SVG)).toBeNull();
		expect(sniffRaster(new TextEncoder().encode('<!doctype html>'))).toBeNull();
		expect(sniffRaster(new Uint8Array())).toBeNull();
	});
});

describe('iconLinks', () => {
	it('prefers apple-touch icons and big sizes, skips SVG, data: and non-https links', () => {
		const html = `
			<link rel="icon" href="/favicon-16.png" sizes="16x16">
			<link rel="icon" type="image/svg+xml" href="/icon.svg">
			<link rel="shortcut icon" href="data:,">
			<link href='/favicon-32.png' rel='icon' sizes='32x32'>
			<link rel="apple-touch-icon" href="https://cdn.acme.example/touch.png?a=1&amp;b=2">
			<link rel="icon" href="http://acme.example/insecure.png">
			<link rel="stylesheet" href="/style.css">`;
		expect(iconLinks(html, new URL('https://acme.example/')).map(String)).toEqual([
			'https://cdn.acme.example/touch.png?a=1&b=2',
			'https://acme.example/favicon-32.png',
			'https://acme.example/favicon-16.png'
		]);
	});
});

describe('iconOrigins', () => {
	it('tries the server origin, then its parent domain', () => {
		expect(iconOrigins('https://mcp.acme.example/mcp').map(String)).toEqual([
			'https://mcp.acme.example/',
			'https://acme.example/'
		]);
		expect(iconOrigins('https://acme.example/mcp').map(String)).toEqual(['https://acme.example/']);
		expect(iconOrigins('https://mcp.acme.co.uk/mcp').map(String)).toEqual([
			'https://mcp.acme.co.uk/',
			'https://acme.co.uk/'
		]);
		expect(iconOrigins('https://acme.co.uk/mcp').map(String)).toEqual(['https://acme.co.uk/']);
	});
});

describe('fetchFavicon', () => {
	it('follows the homepage declaration and returns a raster image', async () => {
		const { fetcher } = fakeFetch({
			'https://mcp.acme.example/': {
				type: 'text/html',
				body: '<link rel="apple-touch-icon" href="/touch.png">'
			},
			'https://mcp.acme.example/touch.png': { type: 'image/png', body: PNG }
		});
		expect(await fetchFavicon('https://mcp.acme.example/mcp', fetcher)).toEqual({
			contentType: 'image/png',
			data: PNG
		});
		// SSRF-safe transport with bounded size and redirects
		expect(fetcher).toHaveBeenCalledWith(
			new URL('https://mcp.acme.example/touch.png'),
			expect.objectContaining({ maxResponseBytes: ICON_MAX_BYTES, maxRedirects: 3 })
		);
	});

	it('ignores SVG and mislabelled content, then falls back to the parent domain favicon', async () => {
		const { fetcher, requested } = fakeFetch({
			'https://mcp.acme.example/': { type: 'text/html', body: '<link rel="icon" href="/x.png">' },
			'https://mcp.acme.example/x.png': { type: 'image/png', body: SVG },
			'https://mcp.acme.example/favicon.ico': { type: 'image/x-icon', body: '<html>' },
			'https://acme.example/favicon.ico': { type: 'text/plain', body: ICO }
		});
		expect(await fetchFavicon('https://mcp.acme.example/mcp', fetcher)).toEqual({
			contentType: 'image/x-icon',
			data: ICO
		});
		expect(requested.length).toBeLessThanOrEqual(8);
	});

	it('returns null when nothing is usable, and never throws', async () => {
		const failing = vi.fn(async () => {
			throw new Error('blocked');
		});
		expect(await fetchFavicon('https://mcp.acme.example/mcp', failing)).toBeNull();
		const { fetcher } = fakeFetch({});
		expect(await fetchFavicon('https://mcp.acme.example/mcp', fetcher)).toBeNull();
	});
});

describe('stored favicons', () => {
	async function addConnector(values: Partial<typeof connector.$inferInsert> = {}) {
		await seedWorkspace(db, [
			{ id: 'alice', role: 'owner' },
			{ id: 'bob', role: 'member' }
		]);
		const [row] = await db
			.insert(connector)
			.values({
				workspaceId: 'ws-1',
				scope: 'shared',
				source: 'url',
				url: 'https://mcp.acme.example/mcp',
				name: 'Acme',
				namespace: `acme${crypto.randomUUID().slice(0, 8)}`,
				authType: 'none',
				...values
			})
			.returning();
		return row;
	}

	it('stores a found icon once, serves it to members only, with a versioned URL', async () => {
		const row = await addConnector();
		const { fetcher } = fakeFetch({
			'https://mcp.acme.example/favicon.ico': { type: 'image/x-icon', body: ICO }
		});
		const now = new Date('2026-11-14T12:00:00Z');
		await refreshConnectorIcon(row, fetcher, now);
		await refreshConnectorIcon(row, fetcher, new Date(now.getTime() + 60_000));
		const calls = fetcher.mock.calls.length;
		expect(calls).toBeGreaterThan(0);
		await refreshConnectorIcon(row, fetcher, new Date(now.getTime() + 3600_000));
		expect(fetcher.mock.calls.length).toBe(calls);

		const versions = await storedIconVersions([row.id]);
		expect(connectorIconUrl(row, versions.get(row.id))).toBe(
			`/connectors/icon/${row.id}?v=${now.getTime()}`
		);
		expect(await readConnectorIcon('bob', row.id)).toEqual({
			contentType: 'image/x-icon',
			data: ICO
		});
		await expect(readConnectorIcon('mallory', row.id)).rejects.toMatchObject({ status: 404 });
	});

	it("hides a personal connector's icon from other members", async () => {
		const row = await addConnector({ scope: 'personal', ownerUserId: 'alice' });
		await db.insert(connectorIcon).values({
			connectorId: row.id,
			contentType: 'image/png',
			data: Buffer.from(PNG),
			fetchedAt: new Date()
		});
		expect((await readConnectorIcon('alice', row.id)).contentType).toBe('image/png');
		await expect(readConnectorIcon('bob', row.id)).rejects.toMatchObject({ status: 404 });
	});

	it('remembers a miss and keeps the monogram (no URL)', async () => {
		const row = await addConnector();
		const { fetcher } = fakeFetch({});
		await refreshConnectorIcon(row, fetcher);
		const [stored] = await db
			.select()
			.from(connectorIcon)
			.where(eq(connectorIcon.connectorId, row.id));
		expect(stored.data).toBeNull();
		expect(connectorIconUrl(row, (await storedIconVersions([row.id])).get(row.id))).toBeNull();
		await expect(readConnectorIcon('alice', row.id)).rejects.toMatchObject({ status: 404 });
	});

	it('uses the committed directory icon for directory connectors, without fetching', async () => {
		const row = await addConnector({ source: 'directory', directoryId: 'linear' });
		const { fetcher } = fakeFetch({});
		await refreshConnectorIcon(row, fetcher);
		expect(fetcher).not.toHaveBeenCalled();
		expect(connectorIconUrl(row, undefined)).toMatch(/linear.*\.png|^data:image\/png/);
	});
});
