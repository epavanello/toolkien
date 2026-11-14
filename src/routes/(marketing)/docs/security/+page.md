---
title: Security
description: Toolkien's threat model, architecture and network isolation, encryption, sandbox, egress controls, OAuth, logs, kill switch and vulnerability reporting.
updated: 2026-11-14
---

Toolkien holds credentials to your services and runs code written by a language model. This page explains what we protect against and how. The goal that drives every choice: **even with the database stolen, no upstream token is readable**.

## Threat model

| Threat                                   | Main defences                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------ |
| Database theft or leaked backup          | Envelope encryption; keys only in OpenBao, separate from database and backups              |
| Malicious or buggy script from the model | Permission-less Deno sandbox, isolated network, bridge checks every call                   |
| Prompt injection asking for writes       | Write calls ask by default; approvals only from a signed-in human                          |
| Tool poisoning by an untrusted server    | Unverified servers flagged in types and UI; warning when descriptions change               |
| SSRF through a user-supplied URL         | https only, private ranges blocked, DNS checked at connect time, egress proxy              |
| Stolen MCP client token                  | 15-minute audience-bound tokens, rotating refresh tokens with reuse detection, kill switch |
| Token confusion between services         | No passthrough: the client's token never goes upstream                                     |
| Account takeover of an admin             | Passkey or 2FA required for owners and admins                                              |
| Abuse of the platform                    | Rate limits per user, workspace and IP; concurrency limits; kill switches                  |

## Architecture and network isolation

Toolkien runs as one Docker Compose stack. Only the app is reachable from the internet.

| Service                                       | Networks               | Exposed                       |
| --------------------------------------------- | ---------------------- | ----------------------------- |
| App (SvelteKit: web, API, MCP server, bridge) | public, core, sandbox  | Yes, behind the reverse proxy |
| OpenBao (secrets)                             | core                   | No                            |
| Egress proxy                                  | core, public           | No                            |
| Runner (Deno)                                 | sandbox, internal only | No                            |

The runner's network is internal: it can reach **only** the bridge in the app, never the internet, the database or OpenBao. No container mounts the Docker socket and there is no docker-in-docker. Containers run read-only with `/tmp` in memory, all capabilities dropped, `no-new-privileges`, and CPU, memory and process limits.

## Envelope encryption with OpenBao

- Each workspace has its own **data key**. Upstream tokens are encrypted with AES-256-GCM using that key, with the workspace id as associated data: a row copied to another workspace no longer decrypts.
- Data keys are stored only **wrapped** by OpenBao's transit engine, with a derived key whose context is the workspace id. The master key never leaves OpenBao.
- The app authenticates to OpenBao with AppRole and short-lived tokens; its policy allows only encrypt, decrypt and rewrap on that one key.
- OpenBao runs with integrated raft storage, never in dev mode, with an audit device on (sensitive values hashed). Keys are rotated and data keys rewrapped in the background without downtime. Unseal keys are kept offline.
- Decryption happens only in the bridge, in memory, at call time. Tokens never appear in logs, errors, responses or the UI.

## The runner sandbox

- A **new Deno process per execution**, started with no permissions at all: no network, no environment variables, no filesystem, no subprocesses, no remote imports. Only the provided modules can be imported.
- The script is type-checked against the declarations before running.
- The script sees only generated functions; each call is serialised over JSON-RPC to the supervisor and on to the bridge, which checks permissions, approvals and kill switches on every call.
- V8 memory limits, a wall-clock timeout (120 s by default), a cap on tool calls (200) and on output size (100 KB), and a forced kill.
- Paused executions store their state encrypted and wipe it when they end or expire. Writes are never replayed on resume.

## SSRF and egress

User-supplied server URLs are `https` only. Private, loopback, link-local, cloud metadata and internal Docker addresses are refused, DNS is resolved and checked at connection time (against rebinding), and redirects to blocked addresses are not followed. Every upstream call leaves through the dedicated egress proxy.

## No token passthrough

The access token your MCP client presents to Toolkien is only ever used to authenticate you to Toolkien. Upstream servers receive Toolkien's own credentials for them (shared or yours), never the client's token.

## OAuth 2.1 for MCP clients

- Toolkien is an OAuth 2.1 authorization server following the MCP authorization specification, with Protected Resource Metadata and Authorization Server Metadata at the well-known endpoints.
- Client ID Metadata Documents are preferred (fetched through the same SSRF-safe transport); dynamic client registration is still accepted for older clients.
- PKCE S256 and the resource indicator are mandatory; tokens are bound to the `/mcp` audience.
- Access tokens last 15 minutes; refresh tokens rotate and reuse is detected.
- The consent screen shows which client asks for access and lets you choose its starting workspace. The MCP endpoint accepts bearer tokens only, never cookies.

## Web application

HttpOnly, Secure, SameSite cookies; CSRF origin checks; a Content Security Policy with nonces and `frame-ancestors 'none'`; HSTS; locked dependencies. Passkeys and TOTP are supported for everyone and required for owners and admins of company workspaces.

## Data minimisation and logs

Toolkien keeps accounts, encrypted credentials, configuration and **metadata** logs: who, when, which client, which connector and tool, outcome, duration and who approved. Never tool arguments, results or script code. Activity logs are append-only and kept 90 days (configurable), then deleted; technical server logs carry no personal data beyond ids and are kept 14 days. Deleting an account anonymises its entries in other workspaces' logs.

## Kill switch

Platform operators and workspace admins can stop activity at once, at three levels: a **user**, a **workspace** or the **whole platform**. Activating one revokes sessions and MCP client tokens in scope (user and platform levels), stops running executions and cancels paused ones; connectors stay configured but suspended. Every switch is logged.

## Limits

Rate limits per user, workspace and IP (60 executions per minute per user by default), runner concurrency per user and globally with a queue, and a workspace kill switch for admins.

## Reporting a vulnerability

Please report vulnerabilities privately to the address on the [security page](/legal/security), with steps to reproduce. Do not access data that is not yours and give us reasonable time to fix the issue before disclosure. Toolkien is open source, so you can review the code that runs the managed service.
