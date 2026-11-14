---
title: MCP reference
description: The six tools Toolkien exposes to MCP clients, the protocol versions and the authorization flow.
updated: 2026-11-14
---

Endpoint: `https://<your-toolkien-host>/mcp`, Streamable HTTP, stateless. Protocol version **2026-07-28**, with negotiation down to 2025-11-25. Authorization: OAuth 2.1 bearer tokens (see [Security](/docs/security)).

The tool list is fixed and short. Tool descriptions teach the agent the flow: search, describe, then execute.

## `workspace_list`

Lists your workspaces and which one is active for this client.

## `workspace_switch`

Switches the active workspace of this client. Use it only when the user asks. It requires human confirmation (an elicitation dialog, or a confirmation link when the client does not support elicitation) and is recorded in the activity log.

## `tools_search`

Full-text search over the tools of the active workspace that you are allowed to use. Returns tool paths and one line of description, and names the active workspace.

## `tools_describe`

Returns the TypeScript declarations (`.d.ts`) of the requested paths: inputs, outputs (or `unknown`), JSDoc descriptions and annotations. Unverified servers are flagged.

## `execute`

Type-checks and runs a TypeScript script in the sandbox. Returns the result and console output (truncated beyond the output limit, with a notice), or a _waiting for approval_ status with an approval link when a call needs confirmation and the client cannot show an elicitation dialog. Always names the workspace.

## `execution_status`

Returns the status of an execution, and resumes a paused one once its approvals are decided.

There is **no tool that approves** anything: approvals come only from a signed-in human.
