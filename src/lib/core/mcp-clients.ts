/**
 * How to connect Toolkien to each MCP client (isomorphic: the connect page and its spec).
 * Source of truth for commands and deeplinks: `docs/notes/mcp-clients.md` (verified against the
 * vendors' docs); the public page `/docs/connect-clients` mirrors it for signed-out readers.
 *
 * Step texts use a tiny inline markup rendered by `Steps`: `**bold**` for UI labels, `` `code` ``
 * for commands and values.
 */

/** Server name used in every command, config and deeplink */
export const SERVER_NAME = 'toolkien';

export const CLIENT_IDS = [
	'claude-code',
	'claude',
	'chatgpt',
	'codex',
	'cursor',
	'vscode',
	'gemini',
	'zed',
	'cline',
	'windsurf',
	'other'
] as const;
export type ClientId = (typeof CLIENT_IDS)[number];

export const isClientId = (value: string | null | undefined): value is ClientId =>
	CLIENT_IDS.includes(value as ClientId);

/** The fastest way in, shown first */
export type InstallMethod =
	/** One-click deeplink that opens the client's own install dialog */
	| { kind: 'link'; label: string; href: string; alternates?: { label: string; href: string }[] }
	/** One terminal command */
	| { kind: 'command'; command: string }
	/** Paste the URL in the client's settings */
	| { kind: 'settings'; settings?: { label: string; href: string }; steps: string[] };

export type ManualSetup = { label: string; lang: 'json' | 'toml' | 'bash'; code: string };

export type ClientNote = { tone: 'info' | 'warning'; title: string; description: string };

export type ClientGuide = {
	id: ClientId;
	/** Used in sentences ("Waiting for Cursor to sign in") */
	name: string;
	/** Tile label when it differs from `name` */
	tile?: string;
	/** Short qualifier on the tile (`CLI`, `Web & desktop`) */
	kind: string;
	/** `main` tiles first, `other` behind "Other clients" */
	group: 'main' | 'other';
	install: InstallMethod;
	/** What follows the install, until the Toolkien consent page opens */
	signIn: { command?: string; steps: string[] };
	manual: ManualSetup[];
	notes: ClientNote[];
};

/** What every client shows once the browser opens (the Toolkien consent page) */
export const CONSENT_STEPS = [
	'Your browser opens Toolkien: sign in if asked (email code or passkey).',
	'On **Connect …**, check the client name, then pick the workspace under **Start in workspace**.',
	'Click **Allow access**. The browser hands control back to your client.'
];

/** `{"url":"…"}` as base64, the `config` parameter of the Cursor deeplink */
export const cursorConfig = (mcpUrl: string) => btoa(JSON.stringify({ url: mcpUrl }));

export const cursorInstallLink = (mcpUrl: string) =>
	`cursor://anysphere.cursor-deeplink/mcp/install?name=${SERVER_NAME}&config=${encodeURIComponent(cursorConfig(mcpUrl))}`;

const vscodeServer = (mcpUrl: string) =>
	JSON.stringify({ name: SERVER_NAME, type: 'http', url: mcpUrl });

export const vscodeInstallLink = (mcpUrl: string, insiders = false) =>
	`${insiders ? 'vscode-insiders' : 'vscode'}:mcp/install?${encodeURIComponent(vscodeServer(mcpUrl))}`;

const json = (value: unknown) => JSON.stringify(value, null, 2);

/** Every client guide, with commands and links built from this instance's MCP URL */
export function clientGuides(mcpUrl: string): ClientGuide[] {
	const name = SERVER_NAME;
	return [
		{
			id: 'claude-code',
			name: 'Claude Code',
			kind: 'CLI',
			group: 'main',
			install: {
				kind: 'command',
				command: `claude mcp add --transport http ${name} ${mcpUrl} --scope user`
			},
			signIn: {
				command: '/mcp',
				steps: [
					'Start `claude` and type `/mcp`.',
					`Select **${name}** and choose **Authenticate**.`,
					...CONSENT_STEPS
				]
			},
			manual: [
				{
					label: 'Same server as JSON',
					lang: 'bash',
					code: `claude mcp add-json ${name} '{"type":"http","url":"${mcpUrl}"}' -s user`
				},
				{
					label: 'Sign in from the shell (add --no-browser over SSH)',
					lang: 'bash',
					code: `claude mcp login ${name}`
				}
			],
			notes: [
				{
					tone: 'info',
					title: 'Scope',
					description:
						'`--scope user` makes Toolkien available in every project. Drop it to add it to the current project only.'
				}
			]
		},
		{
			id: 'claude',
			name: 'Claude',
			kind: 'claude.ai & desktop',
			group: 'main',
			install: {
				kind: 'settings',
				settings: {
					label: 'Open connector settings',
					href: 'https://claude.ai/customize/connectors'
				},
				steps: [
					'Click **+**, then **Add custom connector**.',
					'Name it `Toolkien`, paste the URL below and click **Continue**.',
					'Keep the options marked **Detected** and click **Add**.'
				]
			},
			signIn: {
				steps: ['Click **Connect** next to Toolkien in the connectors list.', ...CONSENT_STEPS]
			},
			manual: [],
			notes: [
				{
					tone: 'info',
					title: 'Desktop app',
					description:
						'Claude Desktop uses the same Customize › Connectors screen; connectors sync between web and desktop.'
				},
				{
					tone: 'warning',
					title: 'Team and Enterprise plans',
					description:
						'An Owner adds the connector once in Admin settings › Connectors (Add › Custom › Web); members then click Connect. The Free plan allows one custom connector.'
				}
			]
		},
		{
			id: 'chatgpt',
			name: 'ChatGPT',
			kind: 'Web',
			group: 'main',
			install: {
				kind: 'settings',
				settings: { label: 'Open ChatGPT settings', href: 'https://chatgpt.com/plugins' },
				steps: [
					'Click **+**, then **Add custom MCP server**.',
					'Name it `Toolkien`, paste the URL below and set authentication to **OAuth**.',
					'Confirm and click **Create**.'
				]
			},
			signIn: {
				steps: ['ChatGPT sends you to Toolkien to authorize the connection.', ...CONSENT_STEPS]
			},
			manual: [],
			notes: [
				{
					tone: 'warning',
					title: 'Plan required',
					description:
						'Full MCP access needs ChatGPT Business, Enterprise or Edu (an admin may need to enable it). Pro is read-only; Free is not supported. Web only.'
				}
			]
		},
		{
			id: 'codex',
			name: 'Codex',
			kind: 'CLI, IDE & app',
			group: 'main',
			install: { kind: 'command', command: `codex mcp add ${name} --url ${mcpUrl}` },
			signIn: {
				command: `codex mcp login ${name}`,
				steps: [`Run \`codex mcp login ${name}\` in your terminal.`, ...CONSENT_STEPS]
			},
			manual: [
				{
					label: '~/.codex/config.toml',
					lang: 'toml',
					code: `[mcp_servers.${name}]\nurl = "${mcpUrl}"`
				}
			],
			notes: [
				{
					tone: 'info',
					title: 'One config for every Codex',
					description:
						'The CLI, the IDE extension and the desktop app share it. In the IDE extension: gear › MCP servers › Add server › Streamable HTTP, paste the URL, Save, then Authenticate.'
				}
			]
		},
		{
			id: 'cursor',
			name: 'Cursor',
			kind: 'Editor',
			group: 'main',
			install: { kind: 'link', label: 'Add to Cursor', href: cursorInstallLink(mcpUrl) },
			signIn: {
				steps: [
					'In Cursor, confirm **Install** in the dialog that opens.',
					'Open **Cursor Settings › MCP**: Toolkien asks you to log in. Click **Connect** (or **Needs login**).',
					...CONSENT_STEPS
				]
			},
			manual: [
				{
					label: '~/.cursor/mcp.json',
					lang: 'json',
					code: json({ mcpServers: { [name]: { url: mcpUrl } } })
				}
			],
			notes: []
		},
		{
			id: 'vscode',
			name: 'VS Code',
			kind: 'GitHub Copilot',
			group: 'main',
			install: {
				kind: 'link',
				label: 'Add to VS Code',
				href: vscodeInstallLink(mcpUrl),
				alternates: [{ label: 'VS Code Insiders', href: vscodeInstallLink(mcpUrl, true) }]
			},
			signIn: {
				steps: [
					'In VS Code, click **Install** on the server page that opens.',
					'On the first connection VS Code asks to allow authentication: click **Allow**.',
					...CONSENT_STEPS
				]
			},
			manual: [
				{
					label: 'From the terminal',
					lang: 'bash',
					code: `code --add-mcp '${vscodeServer(mcpUrl)}'`
				},
				{
					label: '.vscode/mcp.json',
					lang: 'json',
					code: json({ servers: { [name]: { type: 'http', url: mcpUrl } } })
				}
			],
			notes: []
		},
		{
			id: 'gemini',
			name: 'Gemini CLI',
			kind: 'CLI',
			group: 'other',
			install: {
				kind: 'command',
				command: `gemini mcp add --transport http ${name} ${mcpUrl} --scope user`
			},
			signIn: {
				command: `/mcp auth ${name}`,
				steps: [
					`Gemini opens the sign-in on first use, or type \`/mcp auth ${name}\`.`,
					...CONSENT_STEPS
				]
			},
			manual: [],
			notes: []
		},
		{
			id: 'zed',
			name: 'Zed',
			kind: 'Editor',
			group: 'other',
			install: {
				kind: 'settings',
				steps: [
					'Open **Settings › AI › MCP Servers** and click **Add Remote Server**.',
					'Name it `toolkien` and paste the URL below.'
				]
			},
			signIn: { steps: ['Zed asks you to sign in when it first connects.', ...CONSENT_STEPS] },
			manual: [
				{
					label: 'settings.json',
					lang: 'json',
					code: json({ context_servers: { [name]: { url: mcpUrl } } })
				}
			],
			notes: []
		},
		{
			id: 'cline',
			name: 'Cline',
			kind: 'Extension & CLI',
			group: 'other',
			install: { kind: 'command', command: `cline mcp add ${name} ${mcpUrl} --transport http` },
			signIn: {
				command: 'cline mcp',
				steps: ['Run `cline mcp`, select Toolkien and choose **Authorize**.', ...CONSENT_STEPS]
			},
			manual: [],
			notes: [
				{
					tone: 'info',
					title: 'In the editor extension',
					description:
						'Open the Remote Servers tab, enter the name and URL and choose Streamable HTTP.'
				}
			]
		},
		{
			id: 'windsurf',
			name: 'Windsurf',
			kind: 'Editor',
			group: 'other',
			install: {
				kind: 'settings',
				steps: [
					'Open **Customize › MCPs** and add a remote server.',
					'Name it `toolkien` and paste the URL below.'
				]
			},
			signIn: { steps: ['Follow the sign-in prompt when Windsurf connects.', ...CONSENT_STEPS] },
			manual: [],
			notes: []
		},
		{
			id: 'other',
			name: 'your client',
			tile: 'Other',
			kind: 'Any MCP client',
			group: 'other',
			install: {
				kind: 'settings',
				steps: [
					'Add a **remote** MCP server (transport **Streamable HTTP**, sometimes called "HTTP").',
					'Paste the URL below and choose **OAuth** if the client asks for authentication.'
				]
			},
			signIn: {
				steps: ['The client opens your browser when it first connects.', ...CONSENT_STEPS]
			},
			manual: [
				{
					label: 'Common JSON shape',
					lang: 'json',
					code: json({ mcpServers: { [name]: { type: 'http', url: mcpUrl } } })
				}
			],
			notes: [
				{
					tone: 'info',
					title: 'Requirements',
					description:
						'The client must support remote MCP servers with OAuth. Clients that only run local (stdio) servers cannot connect.'
				}
			]
		}
	];
}

export const findGuide = (guides: ClientGuide[], id: string | null | undefined) =>
	guides.find((guide) => guide.id === id) ?? null;

/** Patterns over the OAuth client name an MCP client registers with (self-asserted) */
const NAME_PATTERNS: [ClientId, RegExp][] = [
	['claude-code', /claude[\s-]?code/i],
	['claude', /claude/i],
	['chatgpt', /chatgpt|openai(?!.*codex)/i],
	['codex', /codex/i],
	['cursor', /cursor/i],
	['vscode', /vs\s?code|visual studio code|copilot/i],
	['gemini', /gemini/i],
	['zed', /\bzed\b/i],
	['cline', /cline/i],
	['windsurf', /windsurf|devin|codeium/i]
];

/** Which known client an authorized OAuth client is, from its name (`null` when unknown) */
export function matchClient(name: string | null | undefined): ClientId | null {
	if (!name) return null;
	return NAME_PATTERNS.find(([, pattern]) => pattern.test(name))?.[0] ?? null;
}

/** Copyable prompts for the "Try it" step, using the workspace's connectors when there are any */
export function samplePrompts(connectorNames: string[]): string[] {
	const [first, second] = connectorNames;
	return [
		'Use toolkien to list the tools I can use, grouped by service.',
		first
			? `Use toolkien to show me what I can do with ${first}, then try one read-only call.`
			: 'Use toolkien to list my PostHog insights.',
		second
			? `Use toolkien to combine data from ${first} and ${second} in one short summary.`
			: 'Use toolkien to find my open GitHub issues labelled bug and summarise them.'
	];
}

/** Text with `**bold**` and `` `code` `` segments, for step lists */
export type InlineSegment = { kind: 'text' | 'strong' | 'code'; text: string };

export function inlineSegments(text: string): InlineSegment[] {
	const segments: InlineSegment[] = [];
	const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > last) segments.push({ kind: 'text', text: text.slice(last, match.index) });
		segments.push(
			match[1] !== undefined
				? { kind: 'strong', text: match[1] }
				: { kind: 'code', text: match[2]! }
		);
		last = match.index + match[0].length;
	}
	if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
	return segments;
}
