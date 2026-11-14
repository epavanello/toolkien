---
title: Cookie policy
description: Toolkien uses technical cookies only, so there is no cookie banner.
updated: 2026-11-14
---

> **Draft generated automatically: to be reviewed by a lawyer or DPO before publication.** This text is not legal advice.

Toolkien sets only cookies that are strictly necessary for the service to work. They need no consent, which is why there is no cookie banner. We use no analytics, advertising or third-party tracking cookies: our page analytics (self-hosted Plausible) works without cookies or local storage.

| Cookie                      | Purpose                                                                               | Duration                                  |
| --------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| `better-auth.session_token` | Keeps you signed in (HttpOnly, Secure, SameSite=Lax)                                  | Until the session expires or you sign out |
| `better-auth.session_data`  | Short-lived cache of the session, when enabled                                        | Minutes                                   |
| OAuth flow cookies          | Keep state while an MCP client or an upstream server completes an OAuth authorization | Minutes                                   |

Your light/dark theme choice is kept in your browser's local storage, not in a cookie, and never leaves your device.

MCP clients authenticate with bearer tokens, not cookies.
