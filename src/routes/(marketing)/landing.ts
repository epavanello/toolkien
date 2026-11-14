import Building2 from '@lucide/svelte/icons/building-2';
import FileClock from '@lucide/svelte/icons/file-clock';
import KeyRound from '@lucide/svelte/icons/key-round';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Lock from '@lucide/svelte/icons/lock';
import Network from '@lucide/svelte/icons/network';
import Power from '@lucide/svelte/icons/power';
import ShieldCheck from '@lucide/svelte/icons/shield-check';
import SquareTerminal from '@lucide/svelte/icons/square-terminal';
import Users from '@lucide/svelte/icons/users';
import { CLIENT_ICONS } from '#lib/components/app/client-icons.ts';
import type { ComparePanel, Feature, PathCard } from '#lib/components/marketing/index.ts';
import { LICENSE } from './site.ts';

/**
 * Landing copy (owner: org-ops, voice: docs/brand.md). The storyline, in order of importance:
 * fewer tokens and faster runs (code mode) → connect once, use everywhere → share with your
 * team → security → managed or self-hosted.
 */

export const description =
	'Toolkien is one remote MCP server for all of yours. Add your tools once and use them from Claude, ChatGPT, Codex, Cursor or VS Code: your agent searches tools, reads compact TypeScript types and runs one sandboxed script, with permissions, approvals and an audit trail.';

export const worksWith = [
	{ label: 'Claude', icon: CLIENT_ICONS.claude },
	{ label: 'Claude Code', icon: CLIENT_ICONS['claude-code'] },
	{ label: 'ChatGPT', icon: CLIENT_ICONS.chatgpt },
	{ label: 'Codex', icon: CLIENT_ICONS.codex },
	{ label: 'Cursor', icon: CLIENT_ICONS.cursor },
	{ label: 'VS Code', icon: CLIENT_ICONS.vscode },
	{ label: 'any MCP client', icon: CLIENT_ICONS.other }
];

/*
 * TODO(measurements): replace these illustrative numbers with a measured run (same task, same
 * model, classic tool calling vs Toolkien) and link the method in the docs. Until then the note
 * under the comparison must keep saying "illustrative".
 */
export const tokens: { before: ComparePanel; after: ComparePanel; note: string } = {
	before: {
		label: 'Classic tool calling',
		title: 'Every call is a round trip',
		visual: { kind: 'calls', count: 40 },
		metrics: [
			{ label: 'Model round trips', value: '40', amount: 1 },
			{ label: 'Tokens (schemas + re-sent context)', value: '~180k', amount: 1 },
			{ label: 'Wall time', value: '~4 min', amount: 1 }
		]
	},
	after: {
		label: 'Code mode with Toolkien',
		title: 'One script chains the calls',
		visual: {
			kind: 'script',
			lines: [
				'// tools_search → tools_describe → execute',
				"const issues = await github.listIssues({ state: 'open' });",
				'for (const issue of issues.filter(isUrgent)) {',
				'  await linear.createIssue(toTicket(issue));',
				'}',
				"await slack.postMessage({ channel: '#triage', text })"
			]
		},
		metrics: [
			{ label: 'Model round trips', value: '3', amount: 3 / 40 },
			{ label: 'Tokens (types it asked for)', value: '~12k', amount: 12 / 180 },
			{ label: 'Wall time', value: '~25 s', amount: 25 / 240 }
		]
	},
	note: 'Illustrative example, not a benchmark: one triage task across GitHub, Linear and Slack (40 tool calls). Real measurements are on the way.'
};

const clients = ['Claude', 'ChatGPT', 'Codex', 'Cursor', 'VS Code'];

export const connectOnce: { before: ComparePanel; after: ComparePanel; note: string } = {
	before: {
		label: 'Without Toolkien',
		title: 'Every tool, in every client',
		visual: { kind: 'mesh', rows: clients, columns: 6 },
		metrics: [
			{ label: 'Setups to maintain (5 clients × 6 tools)', value: '30', amount: 1 },
			{ label: 'Sign-ins to renew', value: '30', amount: 1 }
		]
	},
	after: {
		label: 'With Toolkien',
		title: 'Each tool once, each client once',
		visual: { kind: 'hub', rows: clients, columns: 6 },
		metrics: [
			{ label: 'Setups to maintain (6 tools + 5 clients)', value: '11', amount: 11 / 30 },
			{ label: 'Sign-ins to renew', value: '6', amount: 6 / 30 }
		]
	},
	note: 'Add a tool and it shows up in every client at once; remove it and it is gone everywhere. Clients run in parallel on the same workspace.'
};

export const steps = [
	{
		title: 'Search',
		description:
			'The agent searches your workspace’s tools by text and gets back paths with a one-line summary, not hundreds of schemas.',
		code: 'tools_search'
	},
	{
		title: 'Describe',
		description:
			'It reads compact TypeScript declarations of the few tools it needs, generated from each server’s schemas.',
		code: 'tools_describe'
	},
	{
		title: 'Execute',
		description:
			'It runs one script in an isolated sandbox that chains every call. Each call checks permissions; writes can wait for you.',
		code: 'execute'
	}
];

export const example = `// What your agent sends to execute: one script, many calls
const issues = await github.listIssues({ repo: 'acme/web', state: 'open' });
const urgent = issues.filter((issue) => issue.labels.includes('p0'));

await slack.postMessage({
  channel: '#triage',
  text: \`\${urgent.length} urgent issues today\`
}); // "ask" permission: you approve this call first`;

export const teams: Feature[] = [
	{
		icon: Building2,
		title: 'Company workspaces',
		description:
			'Admins connect shared accounts once; colleagues use them from their own clients without ever seeing a token.'
	},
	{
		icon: ShieldCheck,
		title: 'Policy and permissions',
		description:
			'Allow, ask or block per tool, with floors members cannot loosen. Choose whether personal tools or free URLs are allowed.'
	},
	{
		icon: Users,
		title: 'Approvals and audit',
		description:
			'Writes wait for a human. Everyone sees their own timeline; admins see all of it and export CSV.'
	},
	{
		icon: Power,
		title: 'Kill switch',
		description:
			'Stop a workspace in one click: running scripts end, tokens are suspended, configuration stays.'
	}
];

export const security: Feature[] = [
	{
		icon: Lock,
		title: 'Encrypted credentials',
		description:
			'Upstream tokens are sealed with AES-256-GCM and a per-workspace key wrapped by OpenBao. A stolen database reveals no token.'
	},
	{
		icon: SquareTerminal,
		title: 'Sandboxed scripts',
		description:
			'A fresh Deno process with no permissions per execution: no network, no environment, no filesystem. Only the tools you allowed.'
	},
	{
		icon: ListChecks,
		title: 'Approvals come from you',
		description:
			'Approvals are never taken from the model. Writes ask by default; you decide per call or per script.'
	},
	{
		icon: KeyRound,
		title: 'No token passthrough',
		description:
			'The token your client holds is never forwarded upstream. OAuth 2.1 with PKCE, audience-bound short-lived tokens.'
	},
	{
		icon: Network,
		title: 'Egress control',
		description:
			'Upstream calls leave through a dedicated proxy, https only, with private and metadata addresses blocked.'
	},
	{
		icon: FileClock,
		title: 'Metadata-only logs',
		description:
			'Who did what and when, never arguments, results or script code. Kept 90 days, then deleted.'
	}
];

export const paths: PathCard[] = [
	{
		label: 'Recommended',
		title: 'Managed',
		description: 'Sign up, add your first tool, connect your client. We run the rest.',
		points: [
			'Free during early access',
			'Key vault, sandbox, egress proxy and updates handled for you',
			'Company workspaces with invites, roles and audit'
		],
		featured: true
	},
	{
		label: `Open source · ${LICENSE}`,
		title: 'Self-hosted',
		description: 'The same product on your own server, as one Docker Compose stack.',
		points: [
			'App, OpenBao, egress proxy and runner in one compose file',
			'Ready for Coolify, works anywhere Docker runs',
			'Your database, your keys, your network'
		],
		code: 'docker compose up -d'
	}
];
