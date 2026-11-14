# Installing Toolkien in MCP clients (research, 2026-11-14)

Verified against vendor docs on 2026-11-14; "unconfirmed" = not confirmed in official docs.
Placeholders: `{URL}` = `${ORIGIN}/mcp`, `{NAME}` = `toolkien`.

## Claude Code (CLI)

- Install: `claude mcp add --transport http {NAME} {URL} --scope user`
  (`local` default = this project only; `project` writes `.mcp.json`; `user` = all projects).
- Fallback: `claude mcp add-json {NAME} '{"type":"http","url":"{URL}"}' -s user`
- Login is NOT automatic: run `/mcp` in Claude Code → select the server → Authenticate (browser
  opens). Or from the shell: `claude mcp login {NAME}` (`--no-browser` over SSH).
- Source: https://code.claude.com/docs/en/mcp

## Claude.ai (web) and Claude Desktop

- No deeplink. https://claude.ai/customize/connectors → **+** → **Add custom connector** → name
  + URL → Continue → keep the options marked Detected → **Add** → **Connect** (browser OAuth).
  Desktop: same Customize › Connectors screen; connectors sync across web and desktop.
- Plans: Free (1 custom connector), Pro, Max, Team, Enterprise. Team/Enterprise: an Owner adds it
  at https://claude.ai/admin-settings/connectors (Add → Custom → Web), members click Connect.
- Source: https://claude.com/docs/connectors/custom/remote-mcp

## ChatGPT

- https://chatgpt.com/plugins → **+** → **Add custom MCP server** → name, description, URL,
  authentication OAuth → confirm → **Create**. OAuth screen details unconfirmed.
- Plans (partly unconfirmed): full MCP on Business / Enterprise / Edu (admin may need to enable
  it); Pro read-only; Free no. Web only.
- Source: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt

## OpenAI Codex (CLI, IDE extension, desktop app share one config)

- Install: `codex mcp add {NAME} --url {URL}` then `codex mcp login {NAME}`.
- Config: `~/.codex/config.toml` → `[mcp_servers.toolkien]` / `url = "{URL}"`.
- IDE extension: gear → MCP servers → Add server → Streamable HTTP → URL → Save → Authenticate.
- Source: https://learn.chatgpt.com/docs/extend/mcp

## Cursor

- One click: `cursor://anysphere.cursor-deeplink/mcp/install?name={NAME}&config={BASE64}` where
  `{BASE64}` = base64 of `{"url":"{URL}"}` (inner object, no `mcpServers` wrapper).
- Web button variant (undocumented but live):
  `https://cursor.com/en/install-mcp?name={NAME}&config={urlencoded BASE64}`.
- Badges: `https://cursor.com/deeplink/mcp-install-dark.svg` / `mcp-install-light.svg`.
- Fallback `~/.cursor/mcp.json`: `{"mcpServers":{"toolkien":{"url":"{URL}"}}}`.
- Login: Cursor Settings › MCP → the server shows "Needs login"/Connect → browser OAuth (label
  unconfirmed).
- Source: https://cursor.com/docs/context/mcp/install-links

## VS Code (GitHub Copilot)

- One click: `vscode:mcp/install?{encodeURIComponent(JSON.stringify({"name":"{NAME}","type":"http","url":"{URL}"}))}`
  (Insiders: `vscode-insiders:`). HTTPS wrapper for web buttons:
  `https://vscode.dev/redirect?url={encodeURIComponent(vscode link)}`.
- CLI: `code --add-mcp '{"name":"{NAME}","type":"http","url":"{URL}"}'`
- Fallback `.vscode/mcp.json`: `{"servers":{"toolkien":{"type":"http","url":"{URL}"}}}`.
- Login: browser opens on first connect (Copilot asks to allow the authentication).
- Source: https://code.visualstudio.com/docs/agents/reference/mcp-configuration

## Others (remote HTTP + OAuth)

- Gemini CLI: `gemini mcp add --transport http {NAME} {URL} --scope user`; login auto on 401 or
  `/mcp auth {NAME}`.
- Zed: Settings › AI › MCP Servers › Add Remote Server, or `"context_servers": {"toolkien":
  {"url": "{URL}"}}`; OAuth prompted.
- Cline: Remote Servers tab → name, URL, Streamable HTTP; or `cline mcp add {NAME} {URL}
  --transport http` then `cline mcp` → Authorize OAuth.
- Goose: `goose://extension?url={enc URL}&type=streamable_http&id={NAME}&name={NAME}&description={enc}`.
- LM Studio: `lmstudio://add_mcp?name={NAME}&config={base64({"{NAME}":{"url":"{URL}"}})}`.
- Raycast: "Install MCP Server" → HTTP, URL, OAuth Dynamic → Sign In.
- Windsurf (now Devin Desktop): Customize › MCPs; no deeplink.

## Summary for the onboarding UI

- One click: Cursor, VS Code (+ Goose, LM Studio).
- One command: Claude Code, Codex, Gemini CLI.
- Paste URL in settings: Claude.ai/Desktop, ChatGPT, Zed, Windsurf.
- Explicit login step after install: Claude Code (`/mcp`), Codex (`codex mcp login`), Claude.ai
  (Connect), Cline.
