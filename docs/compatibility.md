# MCP client compatibility

Manual matrix of the clients we target. Toolkien's side is fixed (see `docs/notes/mcp.md`); the
client columns record what each client supports, verified by hand against a running Toolkien.
"to verify" = not yet tested by us; values marked "(reported)" come from vendor docs or release
notes, not from our own test.

Last updated: 2026-11-14 (build agent, nothing verified by hand yet).

## What Toolkien offers

| Capability       | Toolkien                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| Transport        | Streamable HTTP, `POST /mcp` only (stateless; GET/DELETE → 405, no `Mcp-Session-Id`)                            |
| Protocol version | `2026-07-28` (per-request `_meta` envelope) and `2025-11-25` (`initialize`); other 2025 versions get 2025-11-25 |
| OAuth            | OAuth 2.1, PKCE S256 required, RFC 8707 resource required for a usable token, RFC 9207 `iss`, 15 min tokens     |
| Registration     | CIMD (preferred by MCP 2026-07-28) and DCR (open, public or confidential clients)                               |
| Elicitation      | Form and URL modes **only on 2026-07-28**; 2025-11-25 clients always get the link fallback                      |
| Notifications    | None sent (no GET stream, no `subscriptions/listen` use yet; the tool list is fixed)                            |

## Matrix

| Client                                     | OAuth             | CIMD / DCR                          | Elicitation form | Elicitation URL | Notifications | Protocol version           |
| ------------------------------------------ | ----------------- | ----------------------------------- | ---------------- | --------------- | ------------- | -------------------------- |
| Claude (claude.ai, Desktop)                | yes (reported)    | DCR yes (reported); CIMD to verify  | to verify        | to verify       | to verify     | to verify                  |
| Claude Code                                | yes (reported)    | DCR yes (reported); CIMD to verify  | to verify        | to verify       | to verify     | to verify                  |
| Codex (CLI / IDE)                          | yes (reported)    | DCR yes (reported); CIMD to verify  | to verify        | to verify       | to verify     | to verify                  |
| Cursor                                     | yes (reported)    | DCR yes (reported); CIMD to verify  | yes (reported)   | to verify       | to verify     | to verify                  |
| VS Code (GitHub Copilot)                   | yes (reported)    | DCR yes (reported); CIMD (reported) | yes (reported)   | to verify       | to verify     | to verify                  |
| MCP Inspector CLI                          | bearer header (✓) | n/a (token passed by hand)          | n/a              | n/a             | n/a           | 2025-11-25 (✓)             |
| `@modelcontextprotocol/client` 2.4 (tests) | ✓ (e2e)           | DCR ✓, CIMD ✓ (e2e)                 | ✓ on 2026-07-28  | unit-tested     | n/a           | 2025-11-25 ✓, 2026-07-28 ✓ |

Note: a client that supports elicitation but speaks 2025-11-25 still gets the **link** from
Toolkien (approval page / workspace confirmation page): see "Elicitation per protocol era" in
`docs/notes/mcp.md`.

## How to verify a client

1. Run Toolkien with a public `ORIGIN` (or `localhost` for desktop clients) and add
   `${ORIGIN}/mcp` as a remote MCP server.
2. **OAuth**: the client opens `/consent` (sign in if needed), shows the client name, then
   connects. Check the registration kind in `oauth_client` (`client_discovery_id` set = CIMD).
3. **Protocol version**: the version the client negotiated (dev logs, or the client's own UI).
4. **Elicitation form**: ask the agent to `workspace_switch` to another workspace; a dialog
   should appear in the client (2026-07-28 only).
5. **Elicitation URL**: same with a client that declares only `elicitation.url`; it should
   open `/consent?switch=…`.
6. **Fallback**: on 2025-11-25 the tool result contains the link and `pending_confirmation`.
   With any client, a pending switch is listed on the workspace "Pending approvals" page, and
   calling `workspace_switch` again while it waits (dialog timed out) returns its link.
7. **Notifications**: nothing is expected today; record whether the client opens a
   `subscriptions/listen` stream or a GET stream (Toolkien answers 405).
