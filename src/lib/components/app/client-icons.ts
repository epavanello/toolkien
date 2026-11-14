import Bot from '@lucide/svelte/icons/bot';
import CodeXml from '@lucide/svelte/icons/code-xml';
import MessageCircle from '@lucide/svelte/icons/message-circle';
import MessagesSquare from '@lucide/svelte/icons/messages-square';
import MousePointer2 from '@lucide/svelte/icons/mouse-pointer-2';
import Plug from '@lucide/svelte/icons/plug';
import Sparkles from '@lucide/svelte/icons/sparkles';
import SquareTerminal from '@lucide/svelte/icons/square-terminal';
import Terminal from '@lucide/svelte/icons/terminal';
import Wind from '@lucide/svelte/icons/wind';
import Zap from '@lucide/svelte/icons/zap';
import type { Component } from 'svelte';
import type { ClientId } from '#lib/core/mcp-clients.ts';

/**
 * Generic monochrome marks for MCP clients (no vendor logos): one lucide icon per client,
 * suggesting its kind (terminal, chat, editor).
 */
export const CLIENT_ICONS: Record<ClientId, Component> = {
	'claude-code': SquareTerminal,
	claude: MessageCircle,
	chatgpt: MessagesSquare,
	codex: Terminal,
	cursor: MousePointer2,
	vscode: CodeXml,
	gemini: Sparkles,
	zed: Zap,
	cline: Bot,
	windsurf: Wind,
	other: Plug
};
