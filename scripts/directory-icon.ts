/**
 * Turns a downloaded logo (SVG, PNG, ICO, WebP, JPEG) into the directory icon format
 * `directory/icons/<id>.png`: a 96×96 opaque PNG, rasterized by the Playwright Chromium already
 * used by the component tests (no image dependencies). Rasterizing drops anything active an SVG
 * might carry. Transparent logos are centred on white with a margin; opaque square icons
 * (apple-touch-icon) fill the tile.
 *
 *   node scripts/directory-icon.ts <id> <file> [<id> <file> …]
 */
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const SIZE = 96;
const root = join(import.meta.dirname, '..');
const TYPES: Record<string, string> = {
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.ico': 'image/x-icon',
	'.webp': 'image/webp',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg'
};

/** Detects the type from the bytes (downloads often have no extension) */
function sniff(bytes: Buffer, name: string): string {
	if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
		return 'image/png';
	if (bytes.readUInt32BE(0) === 0x00000100) return 'image/x-icon';
	if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
	if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP')
		return 'image/webp';
	if (/<svg[\s>]/i.test(bytes.toString('utf8', 0, 2048))) return 'image/svg+xml';
	const byExtension = TYPES[extname(name).toLowerCase()];
	if (byExtension) return byExtension;
	throw new Error(`${name}: not an image`);
}

const args = process.argv.slice(2);
if (args.length === 0 || args.length % 2 !== 0) {
	console.error('Usage: node scripts/directory-icon.ts <id> <file> [<id> <file> …]');
	process.exit(1);
}

const browser = await chromium.launch();
try {
	for (let i = 0; i < args.length; i += 2) {
		const [id, file] = [args[i], args[i + 1]];
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) throw new Error(`${id}: use the entry id`);
		const bytes = await readFile(file);
		const src = `data:${sniff(bytes, file)};base64,${bytes.toString('base64')}`;
		const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
		// No network: the image is inline, nothing else may load
		await page.route('**/*', (route) => route.abort());
		await page.setContent(
			`<!doctype html><html><body style="margin:0;width:${SIZE}px;height:${SIZE}px;background:transparent"></body></html>`
		);
		await page.evaluate(
			async ({ src, size }) => {
				const img = new Image();
				img.src = src;
				await img.decode();
				// Opaque corners = a full-bleed square icon; otherwise a logo on white with a margin
				const probe = document.createElement('canvas');
				probe.width = probe.height = 32;
				const ctx = probe.getContext('2d')!;
				ctx.drawImage(img, 0, 0, 32, 32);
				const corners = [
					[0, 0],
					[31, 0],
					[0, 31],
					[31, 31]
				].map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3]);
				const opaque = corners.every((alpha) => alpha > 250);
				const margin = opaque ? 0 : Math.round(size * 0.16);
				document.body.style.background = '#ffffff';
				img.style.cssText = `display:block;width:${size - 2 * margin}px;height:${size - 2 * margin}px;margin:${margin}px;object-fit:contain`;
				document.body.append(img);
			},
			{ src, size: SIZE }
		);
		const out = join(root, 'directory/icons', `${id}.png`);
		await page.screenshot({ path: out, type: 'png', omitBackground: false });
		await page.close();
		console.log(`directory/icons/${id}.png`);
	}
} finally {
	await browser.close();
}
