import { brand } from '#lib/brand.ts';
import { DOCS } from '../docs/nav.ts';
import { LEGAL_DOCUMENTS, REPO_URL } from '../site.ts';
import type { RequestHandler } from './$types';

/** llms.txt (llmstxt.org): what Toolkien is and where the docs are, for AI assistants */
export const GET: RequestHandler = ({ url }) => {
	const link = (path: string, label: string, note?: string) =>
		`- [${label}](${url.origin}${path})${note ? `: ${note}` : ''}`;
	const body = [
		`# ${brand.name}`,
		'',
		`> ${brand.tagline} ${brand.name} is a gateway MCP server in code mode: connect one remote MCP server (${url.origin}/mcp) to Claude, Codex, Cursor or VS Code and use every remote MCP server configured in ${brand.name}. Agents search tools, read TypeScript declarations and run scripts in a Deno sandbox, with per-tool permissions, human approvals and encrypted credentials. Open source (AGPL-3.0), free managed service during the early phase.`,
		'',
		...DOCS.flatMap((group) => [
			`## ${group.title}`,
			'',
			...group.pages.map((page) => link(page.href, page.label, page.description)),
			''
		]),
		'## Legal (drafts)',
		'',
		...LEGAL_DOCUMENTS.map((doc) => link(`/legal/${doc.slug}`, doc.label)),
		'',
		'## Optional',
		'',
		link('/llms-full.txt', 'Full documentation', 'every docs page and legal draft in one file'),
		`- [Source code](${REPO_URL})`,
		''
	].join('\n');
	return new Response(body, {
		headers: {
			'Content-Type': 'text/markdown; charset=utf-8',
			'Cache-Control': 'public, max-age=3600'
		}
	});
};
