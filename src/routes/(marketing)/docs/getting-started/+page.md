---
title: Getting started
description: Create an account, add your first connector and connect Claude, Codex or Cursor.
updated: 2026-11-14
---

## 1. Create an account

[Sign up](/signup) with your email: we send a 6-digit code and a sign-in link, no password needed. You can add a passkey later in **Settings → Account**. Every account starts with a **personal workspace**.

## 2. Add a connector

Open **Connectors** and pick a server from the **Directory** (curated, with verified annotations) or add the URL of any remote MCP server (marked _unverified_). Then authenticate: OAuth opens the provider's consent page; token-based servers ask you to paste an API key, ideally a read-only one.

Toolkien reads the server's tools and generates TypeScript declarations for them.

## 3. Connect your MCP client

Add one remote MCP server to your client, with the URL of your Toolkien instance:

```text
https://<your-toolkien-host>/mcp
```

The client opens a browser window: sign in to Toolkien, review the client asking for access and choose the workspace it starts in. Signed in, the **Connect your AI** page of the app walks you through it for your client; [Connect your AI client](/docs/connect-clients) has every client step by step.

- **Claude** (desktop and web): add a custom connector with the URL above.
- **Codex**, **VS Code** and other clients: add a remote (Streamable HTTP) MCP server with the URL above.
- **Cursor**: add it to your MCP configuration:

```json
{
	"mcpServers": {
		"toolkien": { "url": "https://<your-toolkien-host>/mcp" }
	}
}
```

Clients that support Client ID Metadata Documents register automatically; older clients use dynamic client registration.

## 4. Ask your agent

Ask for something that needs your tools, for example _"list my open GitHub issues labelled p0 and post a summary in #triage"_. The agent searches, describes and executes. When it reaches a tool set to **ask**, you approve the call in your client (if it supports elicitation) or on the Toolkien approval page it links to.

Everything that happened is in **Activity**, without the content.
