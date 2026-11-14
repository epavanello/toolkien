---
title: Sub-processors
description: Third parties that process data for the managed Toolkien service.
updated: 2026-11-14
---

> **Draft generated automatically: to be reviewed by a lawyer or DPO before publication.** This text is not legal advice.

The managed Toolkien service uses the following sub-processors. All of them process data in the European Union.

| Sub-processor                       | Purpose                                                                                        | Data                                                          | Location          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------- |
| **[VPS provider, to be confirmed]** | Hosting of the application, the OpenBao secrets store, the sandbox runner and the egress proxy | All service data in transit; encryption keys (OpenBao)        | EU (**[region]**) |
| **Turso (ChiselStrike Inc.)**       | Managed database (libSQL)                                                                      | Accounts, configuration, encrypted credentials, metadata logs | EU region         |

What is **not** a sub-processor:

- **The MCP servers you connect** (GitHub, Gmail, Slack…): you choose them and they receive data from your agent under their own terms.
- **Analytics or advertising providers**: we use none.
- **Email providers**: Toolkien sends no email; invitations are links you share yourself.

We will announce changes to this list at least **[30] days** in advance.
