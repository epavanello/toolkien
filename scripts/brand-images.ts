/**
 * Renders the static brand images into `static/` with the Playwright Chromium already used by the
 * component tests (no image dependencies): the Open Graph card (`og.png`, 1200×630) and the PNG
 * app icons (`apple-touch-icon.png`, `icon-192.png`, `icon-512.png`). Re-run after a rename in
 * `src/lib/brand.ts`:
 *
 *   node scripts/brand-images.ts
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { brand } from '../src/lib/brand.ts';

const root = join(import.meta.dirname, '..');
const font = await readFile(
	join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')
);

const escape = (value: string) =>
	value.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

// Same tokens as src/routes/layout.css (dark theme), written as hex for the renderer
const base = `
@font-face { font-family: Inter; src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; }
html, body { width: 100%; height: 100%; }
body { font-family: Inter, sans-serif; background: #0a0a0a; color: #fafafa; -webkit-font-smoothing: antialiased; }
.mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
`;

const monogram = (size: number, radius: number, border = true) =>
	`<div style="width:${size}px;height:${size}px;border-radius:${radius}px;background:#171717;border:${border ? '1px solid #2e2e2e' : '0'};display:flex;align-items:center;justify-content:center;font-weight:650;font-size:${size * 0.55}px;color:#fff;letter-spacing:-0.02em">${escape(brand.name.charAt(0))}</div>`;

const og = `<!doctype html><html><head><style>${base}
body { padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between;
  background: radial-gradient(1200px 600px at 100% 0%, rgba(59,111,230,0.22), transparent 60%), #0a0a0a; }
.brand { display: flex; align-items: center; gap: 18px; font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }
h1 { font-size: 76px; line-height: 1.04; font-weight: 650; letter-spacing: -0.035em; max-width: 900px; }
p { margin-top: 24px; font-size: 30px; line-height: 1.35; color: #a3a3a3; max-width: 940px; }
.flow { display: flex; align-items: center; gap: 14px; font-size: 24px; color: #d4d4d4; }
.flow span.tool { padding: 10px 16px; border: 1px solid #2e2e2e; border-radius: 10px; background: #141414; }
.flow span.arrow { color: #5b8cff; }
.foot { display: flex; align-items: center; justify-content: space-between; }
.tag { font-size: 22px; color: #a3a3a3; }
</style></head><body>
<div class="brand">${monogram(56, 12)}${escape(brand.name)}</div>
<div>
  <h1>${escape(brand.tagline)}</h1>
  <p>One remote MCP server for all of yours. Agents search tools, read typed declarations and run sandboxed scripts, with permissions and approvals.</p>
</div>
<div class="foot">
  <div class="flow mono"><span class="tool">tools_search</span><span class="arrow">→</span><span class="tool">tools_describe</span><span class="arrow">→</span><span class="tool">execute</span></div>
  <div class="tag">Open source · AGPL-3.0</div>
</div>
</body></html>`;

const icon = (size: number) =>
	`<!doctype html><html><head><style>${base} body { background: transparent; }</style></head><body style="width:${size}px;height:${size}px">${monogram(size, 0, false)}</body></html>`;

const browser = await chromium.launch();
try {
	const shots: { file: string; html: string; width: number; height: number }[] = [
		{ file: 'og.png', html: og, width: 1200, height: 630 },
		// Full-bleed squares: iOS and Android apply their own mask
		{ file: 'apple-touch-icon.png', html: icon(180), width: 180, height: 180 },
		{ file: 'icon-192.png', html: icon(192), width: 192, height: 192 },
		{ file: 'icon-512.png', html: icon(512), width: 512, height: 512 }
	];
	for (const shot of shots) {
		const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height } });
		await page.setContent(shot.html, { waitUntil: 'load' });
		await page.evaluate(() => document.fonts.ready);
		await page.screenshot({ path: join(root, 'static', shot.file), type: 'png' });
		await page.close();
		console.log(`static/${shot.file}`);
	}
} finally {
	await browser.close();
}
