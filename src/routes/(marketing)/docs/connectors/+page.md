---
title: Connectors & directory
description: Add remote MCP servers from the curated directory or by URL, authenticate them, and contribute directory entries.
updated: 2026-11-14
---

A **connector** is a remote MCP server configured in a workspace. Toolkien supports remote servers over Streamable HTTP, `https` only.

## Directory or free URL

- **Directory**: a curated list of popular servers with checked configuration and verified annotations (which tools are read-only or destructive). Official, checked directory servers get sensible default permissions; community-maintained entries and entries still under review get them as a proposal you confirm, like a free URL.
- **Free URL**: any remote MCP server. It is marked **unverified**: its tool descriptions come from a third party, are flagged as such in the TypeScript declarations and in the UI, and you are warned when they change. Every tool starts as _to confirm_.

Company workspace admins can restrict both (see [Workspaces & roles](/docs/workspaces)).

## Shared and personal connectors

- **Shared**: an admin authenticates once with company credentials; members use it without ever seeing the token.
- **Personal in a workspace**: every member authenticates their own account (for example their own mailbox).
- **Only for me**: a member's own connector, when the workspace policy allows it.

## Authentication

- **OAuth** with PKCE and minimal scopes. Toolkien registers itself with the server (Client ID Metadata Document or dynamic registration), refreshes tokens automatically and revokes them when you remove the connector, where the provider supports revocation.
- **Token or API key** pasted once. Prefer narrowly scoped, read-only keys.

Credentials are encrypted at rest and decrypted only by the bridge, in memory, at call time. They never reach logs, errors, the UI or your MCP client.

## Contributing a directory entry

The directory lives in the repository as one JSON file per server in `directory/servers/`, validated against `directory/schema.json` in CI. To propose a server:

1. Copy an existing file to `directory/servers/<id>.json` (`id` in kebab-case, never renamed later).
2. Use the vendor's **official** remote endpoint and documentation page.
3. Add `tools` entries only for tools you checked, with the annotations you are sure of. A wrong `readOnlyHint` would let a write run without confirmation; when in doubt, leave it out.
4. Fill in `verification` honestly (`verified`, `community` or `unverified`, with notes).
5. Run `pnpm directory:validate` and open a pull request.

Reviewers check remote https endpoints only, official sources, annotation accuracy, minimal scopes and honest verification notes. See `directory/CONTRIBUTING.md` in the repository.
