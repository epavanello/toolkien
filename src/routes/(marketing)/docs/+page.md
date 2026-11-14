---
title: Documentation
description: Toolkien is one remote MCP server in front of all of yours, with code mode, permissions and encrypted credentials.
updated: 2026-11-14
---

Toolkien is a **gateway MCP server in code mode**. You connect one MCP server to your AI clients (Claude, Codex, Cursor, VS Code and others) and, through it, use every remote MCP server you configured in Toolkien.

Instead of loading hundreds of tool schemas into the model's context, your agent:

1. **searches** for tools by text,
2. **describes** only the ones it needs, as TypeScript declarations,
3. **executes** a short TypeScript script in a sandbox that can only call the tools you allowed.

Write calls follow your permissions: allowed, asked for your confirmation, or blocked.

## Where to go next

- [Getting started](/docs/getting-started): create an account, add a connector, connect your client.
- [How it works](/docs/how-it-works): the search, describe, execute loop.
- [Connectors & directory](/docs/connectors): adding servers, authentication, refresh, contributing to the directory.
- [Permissions & approvals](/docs/permissions): allow, ask, block, and approvals.
- [Workspaces & roles](/docs/workspaces): personal and company workspaces.
- [Security](/docs/security): threat model and every protection in detail.
- [Self-hosting](/docs/self-hosting): run your own instance.
- [MCP reference](/docs/reference): the six tools Toolkien exposes.

Toolkien is open source (AGPL-3.0) and available as a managed service, free during the early phase.
