import { query } from '$app/server';
import { z } from 'zod';
import { HIGHLIGHT_LANGS, highlight, MAX_HIGHLIGHT_CHARS } from '#lib/server/highlight.ts';

/**
 * Highlighted HTML for `CodeBlock` (Shiki stays on the server). No guard on purpose: public
 * pages (landing) show code too, the function is pure and its input bounded. Batched, so a page
 * with many signatures (connector tools) makes one request.
 */
export const highlightCode = query.batch(
	z.object({
		code: z.string().max(MAX_HIGHLIGHT_CHARS),
		lang: z.enum(HIGHLIGHT_LANGS)
	}),
	async (inputs) => {
		const html = await Promise.all(inputs.map(({ code, lang }) => highlight(code, lang)));
		return (_input, index) => html[index]!;
	}
);
