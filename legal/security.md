---
title: Security
description: How the managed Toolkien service protects your accounts and data, and how to report a vulnerability.
updated: 2026-11-14
---

> **Draft generated automatically: to be reviewed by a lawyer or DPO before publication.** This text is not legal advice.

Toolkien is designed so that even a stolen database exposes no upstream token. The full technical description (threat model, architecture, encryption, sandbox, egress, OAuth, logs and kill switch) is in the [security documentation](/docs/security); this page summarises our commitments.

## Commitments

- **Credentials are encrypted** with a per-workspace key wrapped by OpenBao and decrypted only in memory, at call time.
- **Scripts run sandboxed**: one permission-less Deno process per execution, on an internal network that can only reach the bridge.
- **No token passthrough**: the token your MCP client holds is never sent upstream.
- **Humans approve writes**: approvals never come from the model.
- **Metadata-only logs**: no arguments, results or script code.
- **Strong authentication** for owners and admins of company workspaces (a registered passkey).
- **EU hosting** and a short list of [sub-processors](/legal/sub-processors).

## Reporting a vulnerability

Write to **[security contact email]** with a description and steps to reproduce. Please give us reasonable time to fix the issue before disclosing it and do not access data that is not yours. We will acknowledge your report within **[3] business days**. Toolkien is open source: you can also review the code in the public repository.
