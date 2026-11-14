import { brand } from '#lib/brand.ts';
import { docsMarkdown, legalMarkdown } from '../content.ts';
import type { RequestHandler } from './$types';

/** Every docs page and legal draft as one markdown file, for AI assistants */
export const GET: RequestHandler = ({ url }) => {
	const sections = [...docsMarkdown(), ...legalMarkdown()].map(
		(page) => `# ${page.title}\n\nSource: ${url.origin}${page.href}\n\n${page.body}`
	);
	return new Response(
		[`# ${brand.name}: ${brand.tagline}`, ...sections].join('\n\n---\n\n') + '\n',
		{
			headers: {
				'Content-Type': 'text/markdown; charset=utf-8',
				'Cache-Control': 'public, max-age=3600'
			}
		}
	);
};
