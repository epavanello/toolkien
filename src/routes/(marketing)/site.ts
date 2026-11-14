import { REPOSITORY_URL } from '#lib/brand.ts';
import type { SiteLink, SiteLinkGroup } from '#lib/components/marketing/index.ts';
import { DOCS_PAGES } from './docs/nav.ts';

/**
 * Public site configuration (owner: org-ops): links, legal documents and the list of public
 * pages that feeds the sitemap and llms.txt.
 */

/** Source repository (single value in `#lib/brand.ts`, shared with the app shell) */
export const REPO_URL = REPOSITORY_URL;
export const LICENSE = 'AGPL-3.0';
export const SECURITY_CONTACT = 'security@toolkien.example';

export const LEGAL_DOCUMENTS = [
	{ slug: 'privacy', label: 'Privacy policy' },
	{ slug: 'terms', label: 'Terms of service' },
	{ slug: 'dpa', label: 'Data processing agreement' },
	{ slug: 'sub-processors', label: 'Sub-processors' },
	{ slug: 'retention', label: 'Data retention' },
	{ slug: 'security', label: 'Service security' },
	{ slug: 'cookies', label: 'Cookie policy' }
] as const;

export type LegalSlug = (typeof LEGAL_DOCUMENTS)[number]['slug'];

export const headerLinks: SiteLink[] = [
	{ label: 'Docs', href: '/docs' },
	{ label: 'Security', href: '/docs/security' },
	{ label: 'Self-hosting', href: '/docs/self-hosting' },
	{ label: 'GitHub', href: REPO_URL, external: true }
];

export const footerGroups: SiteLinkGroup[] = [
	{
		title: 'Product',
		links: [
			{ label: 'Get started', href: '/signup' },
			{ label: 'Sign in', href: '/login' },
			{ label: 'Source code', href: REPO_URL, external: true }
		]
	},
	{
		title: 'Docs',
		links: [
			{ label: 'Getting started', href: '/docs/getting-started' },
			{ label: 'Connect your AI client', href: '/docs/connect-clients' },
			{ label: 'How it works', href: '/docs/how-it-works' },
			{ label: 'Security', href: '/docs/security' },
			{ label: 'Self-hosting', href: '/docs/self-hosting' }
		]
	},
	{
		title: 'Legal',
		links: LEGAL_DOCUMENTS.map((doc) => ({ label: doc.label, href: `/legal/${doc.slug}` }))
	}
];

export type PublicPage = { path: string; title: string; description: string; priority: number };

/** Every indexable page: landing, docs, legal, sign-up */
export const publicPages = (): PublicPage[] => [
	{
		path: '/',
		title: 'Toolkien',
		description: 'One MCP server for every remote MCP server.',
		priority: 1
	},
	...DOCS_PAGES.map((page) => ({
		path: page.href,
		title: page.label,
		description: page.description,
		priority: 0.8
	})),
	{
		path: '/signup',
		title: 'Create an account',
		description: 'Start with Toolkien for free.',
		priority: 0.5
	},
	...LEGAL_DOCUMENTS.map((doc) => ({
		path: `/legal/${doc.slug}`,
		title: doc.label,
		description: `${doc.label} (draft).`,
		priority: 0.3
	}))
];
