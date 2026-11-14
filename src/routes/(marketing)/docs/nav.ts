import type { SiteLinkGroup } from '#lib/components/marketing/index.ts';

export type DocsPage = { label: string; href: string; description: string };

/**
 * The docs table of contents, single source for the sidebar, previous/next links, the sitemap
 * and llms.txt. Add a page here and create `docs/<slug>/+page.md`.
 */
export const DOCS: { title: string; pages: DocsPage[] }[] = [
	{
		title: 'Start',
		pages: [
			{
				label: 'Overview',
				href: '/docs',
				description: 'What Toolkien is and how the docs are organised.'
			},
			{
				label: 'Getting started',
				href: '/docs/getting-started',
				description: 'Create an account, add a connector and connect Claude, Codex or Cursor.'
			},
			{
				label: 'Connect your AI client',
				href: '/docs/connect-clients',
				description:
					'Step-by-step setup in Claude Code, Claude, ChatGPT, Codex, Cursor, VS Code and other MCP clients.'
			},
			{
				label: 'How it works',
				href: '/docs/how-it-works',
				description: 'Code mode: search, describe, then execute a TypeScript script.'
			}
		]
	},
	{
		title: 'Using Toolkien',
		pages: [
			{
				label: 'Connectors & directory',
				href: '/docs/connectors',
				description:
					'Directory servers, free URLs, upstream auth, refresh, and contributing a directory entry.'
			},
			{
				label: 'Permissions & approvals',
				href: '/docs/permissions',
				description: 'Allow, ask, block; runtime approvals; admin floors.'
			},
			{
				label: 'Workspaces & roles',
				href: '/docs/workspaces',
				description: 'Personal and company workspaces, roles, invite links, policy, switching.'
			}
		]
	},
	{
		title: 'Operations',
		pages: [
			{
				label: 'Security',
				href: '/docs/security',
				description: 'Threat model, isolation, encryption, sandbox, SSRF, OAuth, logs, kill switch.'
			},
			{
				label: 'Self-hosting',
				href: '/docs/self-hosting',
				description: 'Run Toolkien yourself with Docker Compose or Coolify.'
			},
			{
				label: 'MCP reference',
				href: '/docs/reference',
				description: 'The six tools Toolkien exposes to MCP clients.'
			}
		]
	}
];

export const DOCS_PAGES: DocsPage[] = DOCS.flatMap((group) => group.pages);

export const docsNavGroups = (): SiteLinkGroup[] =>
	DOCS.map((group) => ({
		title: group.title,
		links: group.pages.map((page) => ({ label: page.label, href: page.href }))
	}));
