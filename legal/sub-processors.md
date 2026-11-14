---
title: Sub-processors
description: Third parties that process data for the managed Toolkien service.
updated: 2026-11-14
---

> **Draft generated automatically: to be reviewed by a lawyer or DPO before publication.** This text is not legal advice.

The managed Toolkien service uses the following sub-processors. They process data in the European Union; Resend is a US company sending from its EU region, covered by **[Standard Contractual Clauses / EU-US Data Privacy Framework, to be confirmed]**.

| Sub-processor                       | Purpose                                                                                        | Data                                                                  | Location                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------- |
| **[VPS provider, to be confirmed]** | Hosting of the application, the OpenBao secrets store, the sandbox runner and the egress proxy | All service data in transit; encryption keys (OpenBao)                | EU (**[region]**)                         |
| **Turso (ChiselStrike Inc.)**       | Managed database (libSQL)                                                                      | Accounts, configuration, encrypted credentials, metadata logs         | EU region                                 |
| **Resend** (**[legal entity]**)     | Transactional email: sign-in codes and links, workspace invitations                            | Recipient email address, message content (code, link, workspace name) | EU sending region (**[to be confirmed]**) |

What is **not** a sub-processor:

- **The MCP servers you connect** (GitHub, Gmail, Slack…): you choose them and they receive data from your agent under their own terms.
- **Analytics**: cookieless page analytics with Plausible Analytics (open source), self-hosted by us in the EU; it receives redacted page addresses only (see the privacy policy). **Advertising providers**: we use none.
- **Marketing email providers**: Toolkien sends transactional email only (sign-in, invitations), never newsletters or marketing.

We will announce changes to this list at least **[30] days** in advance.
