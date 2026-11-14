import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { mdsvex } from 'mdsvex';
import rehypeSlug from 'rehype-slug';
import { join } from 'node:path';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			// `+page.md` files (legal, docs, blog) render through the markdown layout
			extensions: ['.svelte', '.md'],
			preprocess: [
				mdsvex({
					extensions: ['.md'],
					rehypePlugins: [rehypeSlug],
					layout: {
						_: join(import.meta.dirname, 'src/lib/components/markdown/markdown-layout.svelte')
					}
				})
			],
			compilerOptions: {
				// Force runes mode for the project, except for libraries and mdsvex output (which uses
				// `$$props`). Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') || filename.endsWith('.md')
						? undefined
						: true,
				experimental: { async: true }
			},
			adapter: adapter(),
			experimental: { remoteFunctions: true },
			// The origin check is reimplemented in hooks (`isCrossSiteFormRequest`) so that the
			// OAuth token/register endpoints can accept form posts from non-browser MCP clients
			csrf: { trustedOrigins: ['*'] },
			// Nonces for SvelteKit's inline scripts; extra headers (HSTS, …) are set in hooks
			csp: {
				mode: 'auto',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					// Inline style attributes (bits-ui positioning, transitions)
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'https:'],
					'font-src': ['self', 'data:'],
					'connect-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['self'],
					// Form posts stay on our origin; OAuth redirects happen after fetch-based flows
					'form-action': ['self'],
					'frame-ancestors': ['none']
				}
			}
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
