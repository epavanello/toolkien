import { REPOSITORY_URL } from '#lib/brand.ts';

/**
 * Links for "Missing a server?": a prefilled GitHub issue (request) and a GitHub "new file"
 * page with a ready-to-fill entry in `directory/servers/` (contribution via pull request).
 */

const slug = (value: string) =>
	value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);

/** Prefilled server request (issue form `.github/ISSUE_TEMPLATE/server-request.yml`) */
export const requestServerUrl = (name = '') =>
	`${REPOSITORY_URL}/issues/new?template=server-request.yml&title=${encodeURIComponent(
		`Server request: ${name.trim() || '<name>'}`
	)}`;

/** GitHub editor on a new `directory/servers/<id>.json` with the entry template */
export function addServerUrl(name = '') {
	const id = slug(name) || 'my-server';
	const entry = {
		$schema: '../schema.json',
		id,
		name: name.trim() || 'My Server',
		description: 'One plain sentence about what the tools do.',
		homepage: 'https://example.com/docs/mcp',
		url: 'https://mcp.example.com/mcp',
		namespace: id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase()).replace(/^\d+/, ''),
		publisher: 'official',
		category: 'other',
		tags: [],
		auth: { type: 'oauth' },
		tools: {},
		verification: {
			status: 'needs-review',
			by: 'your-github-handle',
			on: new Date().toISOString().slice(0, 10),
			notes: 'How you checked the endpoint (docs page, a real session, tools/list).'
		}
	};
	const value = `${JSON.stringify(entry, null, '\t')}\n`;
	return `${REPOSITORY_URL}/new/main/directory/servers?filename=${encodeURIComponent(`${id}.json`)}&value=${encodeURIComponent(value)}`;
}

export const contributingUrl = `${REPOSITORY_URL}/blob/main/directory/CONTRIBUTING.md`;
