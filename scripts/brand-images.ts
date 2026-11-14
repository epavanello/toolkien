/**
 * Renders the static brand assets with the Playwright Chromium already used by the component
 * tests (no image dependencies). Single source: the geometry and hex colours in
 * `src/lib/components/brand/paths.ts`, the name in `src/lib/brand.ts`, the docs nav. Outputs:
 *
 * - `static/og.png`: the brand Open Graph card (1200×630)
 * - `static/og/docs/<slug>.png`: one card per docs page (title on the brand background)
 * - `static/apple-touch-icon.png`, `static/icon-192.png`, `static/icon-512.png`,
 *   `static/icon-maskable-512.png`: app icons (rings on the ink tile)
 * - `static/brand/*.svg`: logo files for press and READMEs (wordmark light/dark, mark, tile)
 *
 * Re-run after changing the brand or the docs nav:
 *
 *   node scripts/brand-images.ts
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { brand } from '../src/lib/brand.ts';
import { BRAND_HEX, MARK_RINGS, ringsSvg, WORDMARK } from '../src/lib/components/brand/paths.ts';
import { docsOgSlug } from '../src/lib/components/seo/og.ts';
import { DOCS, DOCS_PAGES } from '../src/routes/(marketing)/docs/nav.ts';

const root = join(import.meta.dirname, '..');
const asBase64 = async (path: string) => (await readFile(join(root, path))).toString('base64');
const inter = await asBase64(
	'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2'
);
const fraunces = await asBase64('src/lib/assets/fonts/fraunces-latin-opsz-wght.woff2');

const escape = (value: string) =>
	value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

const { ink, iron, paper, ember, emberDeep, ash } = BRAND_HEX;

/** Standalone SVGs (also inlined in the HTML cards below) */
const wordmarkSvg = (letters: string, ring: string, height?: number) =>
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${WORDMARK.viewBox}"${height ? ` height="${height}" width="${Math.round(height * WORDMARK.ratio)}"` : ''}><path d="${WORDMARK.letters}" fill="${letters}"/>${ringsSvg(WORDMARK.rings, { a: letters, b: ring }, `wm${height ?? ''}`)}</svg>`;
const markSvg = (
	a: string,
	b: string,
	size?: number,
	tile?: { fill: string; radius: number; inset?: number }
) => {
	const inset = tile?.inset ?? 0;
	const view = `${-inset} ${-inset} ${32 + 2 * inset} ${32 + 2 * inset}`;
	const bg = tile
		? `<rect x="${-inset}" y="${-inset}" width="${32 + 2 * inset}" height="${32 + 2 * inset}" rx="${tile.radius}" fill="${tile.fill}"/>`
		: '';
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}"${size ? ` width="${size}" height="${size}"` : ''}>${bg}${ringsSvg(MARK_RINGS, { a, b }, `mk${size ?? ''}${inset}`)}</svg>`;
};

const base = `
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${inter}) format('woff2'); font-weight: 100 900; }
@font-face { font-family: Fraunces; src: url(data:font/woff2;base64,${fraunces}) format('woff2'); font-weight: 400 800; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; }
body { font-family: Inter, sans-serif; color: ${paper}; -webkit-font-smoothing: antialiased; }
.mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
.display { font-family: Fraunces, Georgia, serif; font-weight: 600; letter-spacing: -0.02em; }
.card { width: 1200px; height: 630px; padding: 64px 72px; position: relative; overflow: hidden;
  display: flex; flex-direction: column; justify-content: space-between;
  background:
    radial-gradient(700px 520px at 92% 18%, ${ember}33, transparent 62%),
    radial-gradient(${paper}14 1.2px, transparent 1.2px) 0 0 / 26px 26px,
    ${ink}; }
.hallmark { display: inline-block; padding: 8px 14px; font-size: 18px; letter-spacing: 0.12em; text-transform: uppercase;
  color: ${ember}; background: ${ember}1f;
  clip-path: polygon(8px 0, calc(100% - 8px) 0, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 0 calc(100% - 8px), 0 8px); }
.foot { display: flex; align-items: center; justify-content: space-between; font-size: 22px; color: ${ash}; }
.flow { display: flex; align-items: center; gap: 12px; font-size: 22px; color: ${paper}; }
.flow .tool { padding: 8px 14px; border: 1px solid ${iron}; border-radius: 10px; background: ${ink}; }
.flow .arrow { color: ${ember}; }
.rings { position: absolute; right: -70px; top: 40px; opacity: 0.95; }
`;

const og = `<!doctype html><html><head><style>${base}
h1 { font-size: 96px; line-height: 1.0; max-width: 820px; }
p.lead { margin-top: 26px; font-size: 30px; line-height: 1.35; color: ${ash}; max-width: 760px; }
</style></head><body><div class="card">
<div class="rings">${markSvg(paper, ember, 520)}</div>
<div>${wordmarkSvg(paper, ember, 54)}</div>
<div>
  <h1 class="display">${escape(brand.tagline)}</h1>
  <p class="lead">Add your tools once, use them from every AI client. One script instead of forty tool calls.</p>
</div>
<div class="foot">
  <div class="flow mono"><span class="tool">tools_search</span><span class="arrow">→</span><span class="tool">tools_describe</span><span class="arrow">→</span><span class="tool">execute</span></div>
  <div>Open source · AGPL-3.0</div>
</div>
</div></body></html>`;

const groupOf = (href: string) => DOCS.find((group) => group.pages.some((p) => p.href === href));

const docsCard = (page: (typeof DOCS_PAGES)[number]) => `<!doctype html><html><head><style>${base}
h1 { font-size: ${page.label.length > 22 ? 76 : 92}px; line-height: 1.02; max-width: 900px; margin-top: 22px; }
p.lead { margin-top: 22px; font-size: 30px; line-height: 1.35; color: ${ash}; max-width: 860px; }
.rings { right: -210px; top: 70px; opacity: 0.3; }
</style></head><body><div class="card">
<div class="rings">${markSvg(paper, ember, 420)}</div>
<div>${wordmarkSvg(paper, ember, 46)}</div>
<div>
  <span class="hallmark mono">Docs · ${escape(groupOf(page.href)?.title ?? 'Toolkien')}</span>
  <h1 class="display">${escape(page.label)}</h1>
  <p class="lead">${escape(page.description)}</p>
</div>
<div class="foot"><div class="display" style="font-style:italic">${escape(brand.tagline)}</div><div>Open source · AGPL-3.0</div></div>
</div></body></html>`;

/** Full-bleed ink square with the rings; `inset` grows the margin (maskable safe zone) */
const icon = (size: number, inset: number) =>
	`<!doctype html><html><head><style>${base} body { background: ${ink}; }</style></head><body style="width:${size}px;height:${size}px">${markSvg(paper, ember, size, { fill: ink, radius: 0, inset })}</body></html>`;

const browser = await chromium.launch();
try {
	await mkdir(join(root, 'static/og/docs'), { recursive: true });
	await mkdir(join(root, 'static/brand'), { recursive: true });

	const shots: { file: string; html: string; width: number; height: number }[] = [
		{ file: 'og.png', html: og, width: 1200, height: 630 },
		...DOCS_PAGES.map((page) => ({
			file: `og/docs/${docsOgSlug(page.href)}.png`,
			html: docsCard(page),
			width: 1200,
			height: 630
		})),
		// Full-bleed squares: iOS and Android apply their own mask
		{ file: 'apple-touch-icon.png', html: icon(180, 3), width: 180, height: 180 },
		{ file: 'icon-192.png', html: icon(192, 2), width: 192, height: 192 },
		{ file: 'icon-512.png', html: icon(512, 2), width: 512, height: 512 },
		{ file: 'icon-maskable-512.png', html: icon(512, 8), width: 512, height: 512 }
	];
	for (const shot of shots) {
		const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
		await page.setContent(shot.html, { waitUntil: 'load' });
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({ path: join(root, 'static', shot.file), type: 'png' });
		await page.close();
		console.log(`static/${shot.file}`);
	}

	const svgs: Record<string, string> = {
		'brand/toolkien-wordmark.svg': wordmarkSvg(ink, emberDeep),
		'brand/toolkien-wordmark-dark.svg': wordmarkSvg(paper, ember),
		'brand/toolkien-mark.svg': markSvg(ink, emberDeep),
		'brand/toolkien-mark-dark.svg': markSvg(paper, ember),
		'brand/toolkien-icon.svg': markSvg(paper, ember, undefined, { fill: ink, radius: 7 })
	};
	for (const [file, svg] of Object.entries(svgs)) {
		await writeFile(join(root, 'static', file), `${svg}\n`);
		console.log(`static/${file}`);
	}
} finally {
	await browser.close();
}
