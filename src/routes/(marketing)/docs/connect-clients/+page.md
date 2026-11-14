---
title: Connect your AI client
description: Step-by-step setup of Toolkien in Claude Code, Claude, ChatGPT, Codex, Cursor, VS Code, Gemini CLI, Zed, Cline and Windsurf.
updated: 2026-11-14
---

Toolkien is one remote MCP server. Every client connects to the same URL, then signs in through your browser:

```text
https://<your-toolkien-host>/mcp
```

On the managed service and on your own instance alike, replace `<your-toolkien-host>` with the address you use to open Toolkien. Signed in, the **Connect your AI** page of the app shows every command below with your URL already filled in, one-click install buttons for Cursor and VS Code, and a live "Connected" check.

## How sign-in works

Every client follows the same three steps the first time it connects:

1. Your browser opens Toolkien. Sign in if asked (email code or passkey).
2. The **Connect …** page names the client asking for access. Check it is the one you just set up, then pick the workspace under **Start in workspace**.
3. Click **Allow access**. The browser hands control back to your client.

Access tokens last 15 minutes and refresh on their own for 30 days of use. Switching workspace later always asks for your confirmation.

## Claude Code

Run once in your terminal (`--scope user` makes it available in every project; drop it for the current project only):

```bash
claude mcp add --transport http toolkien https://<your-toolkien-host>/mcp --scope user
```

Sign-in is not automatic: start `claude`, type `/mcp`, select **toolkien** and choose **Authenticate**. From the shell you can run `claude mcp login toolkien` instead (add `--no-browser` over SSH).

## Claude (claude.ai and Claude Desktop)

1. Open [Customize › Connectors](https://claude.ai/customize/connectors).
2. Click **+**, then **Add custom connector**.
3. Name it `Toolkien`, paste the URL and click **Continue**.
4. Keep the options marked **Detected** and click **Add**, then **Connect** to sign in.

Claude Desktop uses the same screen; connectors sync between web and desktop. The Free plan allows one custom connector. On Team and Enterprise plans an Owner adds the connector once in **Admin settings › Connectors** (Add › Custom › Web); members then click **Connect**.

## ChatGPT

1. Open [ChatGPT settings](https://chatgpt.com/plugins).
2. Click **+**, then **Add custom MCP server**.
3. Name it `Toolkien`, paste the URL, set authentication to **OAuth**, confirm and click **Create**.

Full MCP access needs ChatGPT Business, Enterprise or Edu, and an admin may need to enable it. Pro is read-only and Free is not supported. Web only.

## Codex

The CLI, the IDE extension and the desktop app share one configuration:

```bash
codex mcp add toolkien --url https://<your-toolkien-host>/mcp
codex mcp login toolkien
```

Or edit `~/.codex/config.toml`:

```toml
[mcp_servers.toolkien]
url = "https://<your-toolkien-host>/mcp"
```

In the IDE extension: gear › **MCP servers** › **Add server** › Streamable HTTP, paste the URL, **Save**, then **Authenticate**.

## Cursor

The app's Connect page has an **Add to Cursor** button. Manually, add this to `~/.cursor/mcp.json`:

```json
{
	"mcpServers": {
		"toolkien": { "url": "https://<your-toolkien-host>/mcp" }
	}
}
```

Then open **Cursor Settings › MCP**: Toolkien asks you to log in. Click it to open the browser.

## VS Code (GitHub Copilot)

The app's Connect page has an **Add to VS Code** button. From the terminal:

```bash
code --add-mcp '{"name":"toolkien","type":"http","url":"https://<your-toolkien-host>/mcp"}'
```

Or in `.vscode/mcp.json`:

```json
{
	"servers": {
		"toolkien": { "type": "http", "url": "https://<your-toolkien-host>/mcp" }
	}
}
```

On the first connection VS Code asks to allow the authentication: click **Allow** and the browser opens.

## Other clients

- **Gemini CLI**: `gemini mcp add --transport http toolkien https://<your-toolkien-host>/mcp --scope user`. Sign-in starts on first use, or type `/mcp auth toolkien`.
- **Zed**: **Settings › AI › MCP Servers › Add Remote Server**, or add `toolkien` with the URL under `context_servers` in your settings. Zed asks you to sign in.
- **Cline**: `cline mcp add toolkien https://<your-toolkien-host>/mcp --transport http`, then `cline mcp` and **Authorize**. In the editor extension, use the Remote Servers tab with Streamable HTTP.
- **Windsurf**: **Customize › MCPs**, add a remote server with the URL and follow the sign-in prompt.
- **Any other client**: add a _remote_ MCP server with transport Streamable HTTP and OAuth authentication. Clients that only run local (stdio) servers cannot connect.

## Try it

Once a connector exists in your workspace, ask your agent something that needs it:

- _Use toolkien to list the tools I can use, grouped by service._
- _Use toolkien to list my PostHog insights._
- _Use toolkien to find my open GitHub issues labelled bug and summarise them._

The agent searches, describes and executes. Calls to tools set to **ask** wait for your approval; everything that happened is in **Activity** (searches and descriptions are logged as counts, never the query). The **Connect your AI** page ticks the last step as soon as the first call arrives.

## Troubleshooting

- **The browser never opens**: run the client's sign-in command (`/mcp` in Claude Code, `codex mcp login toolkien`) or look for a "Needs login" / "Connect" button in its MCP settings.
- **"Unverified" next to the client name**: the client registered itself with a name it chose. Allow it only if you just started the connection.
- **Wrong workspace**: ask your agent to switch workspace; Toolkien asks you to confirm.
- **Remove a client**: delete the server in the client's MCP settings (for example `claude mcp remove toolkien`).
