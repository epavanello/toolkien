import { describe, expect, it } from 'vitest';
import {
	CLIENT_IDS,
	clientGuides,
	cursorInstallLink,
	findGuide,
	inlineSegments,
	isClientId,
	matchClient,
	samplePrompts,
	vscodeInstallLink
} from './mcp-clients.ts';

const URL = 'https://toolkien.example/mcp';

describe('client guides', () => {
	it('has one guide per client id, with the URL in every install path', () => {
		const guides = clientGuides(URL);
		expect(guides.map((g) => g.id)).toEqual([...CLIENT_IDS]);
		for (const guide of guides) {
			const install = guide.install;
			const text =
				install.kind === 'command'
					? install.command
					: install.kind === 'link'
						? decodeURIComponent(install.href)
						: guide.manual.map((m) => m.code).join('\n') || URL;
			expect(text, guide.id).toContain(guide.id === 'cursor' ? 'config=' : URL);
			expect(guide.signIn.steps.length, guide.id).toBeGreaterThan(2);
		}
	});

	it('builds the documented commands', () => {
		const guides = clientGuides(URL);
		expect(findGuide(guides, 'claude-code')?.install).toEqual({
			kind: 'command',
			command: `claude mcp add --transport http toolkien ${URL} --scope user`
		});
		expect(findGuide(guides, 'codex')?.signIn.command).toBe('codex mcp login toolkien');
		expect(findGuide(guides, 'nope')).toBeNull();
	});

	it('builds the Cursor deeplink with the base64 inner config', () => {
		const link = new globalThis.URL(cursorInstallLink(URL));
		expect(link.protocol).toBe('cursor:');
		expect(link.searchParams.get('name')).toBe('toolkien');
		expect(JSON.parse(atob(link.searchParams.get('config')!))).toEqual({ url: URL });
	});

	it('builds the VS Code deeplink with the encoded server JSON', () => {
		const link = vscodeInstallLink(URL);
		expect(link.startsWith('vscode:mcp/install?')).toBe(true);
		expect(JSON.parse(decodeURIComponent(link.split('?')[1]!))).toEqual({
			name: 'toolkien',
			type: 'http',
			url: URL
		});
		expect(vscodeInstallLink(URL, true).startsWith('vscode-insiders:')).toBe(true);
	});
});

describe('client helpers', () => {
	it('validates client ids', () => {
		expect(isClientId('cursor')).toBe(true);
		expect(isClientId('netscape')).toBe(false);
		expect(isClientId(null)).toBe(false);
	});

	it('recognises registered client names', () => {
		expect(matchClient('Claude Code (toolkien)')).toBe('claude-code');
		expect(matchClient('Claude')).toBe('claude');
		expect(matchClient('OpenAI Codex')).toBe('codex');
		expect(matchClient('ChatGPT')).toBe('chatgpt');
		expect(matchClient('Visual Studio Code')).toBe('vscode');
		expect(matchClient('My agent')).toBeNull();
		expect(matchClient(null)).toBeNull();
	});

	it('uses connector names in sample prompts when there are some', () => {
		expect(samplePrompts([])).toHaveLength(3);
		expect(samplePrompts([])[1]).toContain('PostHog');
		expect(samplePrompts(['Linear', 'GitHub']).join(' ')).toContain('Linear and GitHub');
	});

	it('splits inline markup', () => {
		expect(inlineSegments('Click **Allow access** then run `codex mcp login`.')).toEqual([
			{ kind: 'text', text: 'Click ' },
			{ kind: 'strong', text: 'Allow access' },
			{ kind: 'text', text: ' then run ' },
			{ kind: 'code', text: 'codex mcp login' },
			{ kind: 'text', text: '.' }
		]);
		expect(inlineSegments('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
	});
});
