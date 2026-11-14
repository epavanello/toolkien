/**
 * Syntax highlighting (Shiki), server side only: the app's `CodeBlock` (through the
 * `highlight.remote.ts` query) and the mdsvex code fences of docs/legal pages (`vite.config.ts`)
 * share this module, so the client bundle never ships Shiki or its grammars.
 *
 * - `shiki/core` + the JavaScript regex engine (no WASM), only the languages we show.
 * - Dual themes as CSS variables (`--shiki-light` / `--shiki-dark`, no default color): the colors
 *   follow mode-watcher's `.dark` class through `layout.css`.
 * - Twoslash (type hovers) only for markdown fences marked ```ts twoslash, at build/SSR time.
 *
 * No `$app/*` imports: `vite.config.ts` loads this file.
 */
import { createHighlighterCore, type HighlighterCore, type ShikiTransformer } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

export const HIGHLIGHT_LANGS = ['ts', 'js', 'json', 'bash', 'text'] as const;
export type HighlightLang = (typeof HIGHLIGHT_LANGS)[number];

/** Fence names → grammar ids; anything else renders as plain (escaped) text */
const ALIASES: Record<string, string> = {
	ts: 'typescript',
	typescript: 'typescript',
	js: 'javascript',
	javascript: 'javascript',
	json: 'json',
	jsonc: 'json',
	bash: 'shellscript',
	sh: 'shellscript',
	shell: 'shellscript',
	shellscript: 'shellscript',
	zsh: 'shellscript'
};

const THEMES = { light: 'github-light', dark: 'github-dark' } as const;

/** Above this size code is shown plain: highlighting is a convenience, not worth the CPU */
export const MAX_HIGHLIGHT_CHARS = 100_000;

let highlighter: Promise<HighlighterCore> | undefined;

function getHighlighter() {
	highlighter ??= createHighlighterCore({
		themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
		langs: [
			import('shiki/langs/typescript.mjs'),
			import('shiki/langs/javascript.mjs'),
			import('shiki/langs/json.mjs'),
			import('shiki/langs/shellscript.mjs')
		],
		engine: createJavaScriptRegexEngine({ forgiving: true })
	});
	return highlighter;
}

const escapeHtml = (value: string) =>
	value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const plain = (code: string) =>
	`<pre class="shiki" tabindex="0"><code>${escapeHtml(code)}</code></pre>`;

/** `<pre class="shiki">…</pre>` HTML for `code`; unknown languages come back escaped, uncolored */
export async function highlight(
	code: string,
	lang: string = 'text',
	options: { meta?: string; transformers?: ShikiTransformer[] } = {}
): Promise<string> {
	const grammar = ALIASES[lang.toLowerCase()];
	if (!grammar || code.length > MAX_HIGHLIGHT_CHARS) return plain(code);
	const shiki = await getHighlighter();
	return shiki.codeToHtml(code, {
		lang: grammar,
		themes: THEMES,
		defaultColor: false,
		meta: options.meta ? { __raw: options.meta } : undefined,
		transformers: options.transformers
	});
}

let twoslash: Promise<ShikiTransformer> | undefined;

/** Type hovers for ```ts twoslash fences (TypeScript runs at build time, never in the browser) */
function twoslashTransformer() {
	twoslash ??= import('@shikijs/twoslash').then(({ transformerTwoslash }) =>
		transformerTwoslash({
			explicitTrigger: true,
			twoslashOptions: {
				compilerOptions: {
					target: 9 /* ES2022 */,
					module: 99 /* ESNext */,
					lib: ['lib.es2022.d.ts']
				}
			}
		})
	);
	return twoslash;
}

/**
 * mdsvex `highlight.highlighter`: Shiki HTML wrapped in `{@html …}` so braces in code never reach
 * the Svelte compiler.
 */
export async function highlightMarkdown(code: string, lang?: string | null, meta?: string | null) {
	const transformers = meta && /\btwoslash\b/.test(meta) ? [await twoslashTransformer()] : [];
	const html = await highlight(code, lang ?? 'text', { meta: meta ?? undefined, transformers });
	return `{@html ${JSON.stringify(html)}}`;
}
