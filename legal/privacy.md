---
title: Privacy policy
description: How the managed Toolkien service handles personal data.
updated: 2026-11-14
---

> **Draft generated automatically: to be reviewed by a lawyer or DPO before publication.** This text is not legal advice.

## Who we are

This policy covers the managed Toolkien service operated by **[Operator legal name]**, **[registered address]**, reachable at **[privacy contact email]** ("we"). Toolkien is open source: if you run your own instance, you are the controller (and, for your users' content, the processor) of the data it handles, and this policy does not apply to your instance.

## The principle: data minimisation

Toolkien is a gateway between your AI clients (Claude, Codex, Cursor…) and the remote MCP servers you connect. It does **not** keep the content that flows through it: tool arguments, tool results and the scripts your agent runs are processed in memory and, when an execution must pause for your approval, stored encrypted only until it ends or expires. We do keep what the service needs to work: your account, encrypted credentials, configuration and metadata logs. We do not claim that we store nothing.

## What we collect

| Category                | Examples                                                | Why                                                    |
| ----------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| Account                 | name, email, passkeys (public keys only)                | Sign-in (email codes and links, passkeys) and security |
| Workspaces              | memberships, roles, invite links (hashed), admin policy | Running personal and company workspaces                |
| Connector configuration | server URLs, names, scopes, permission levels           | Connecting your MCP servers                            |
| Upstream credentials    | OAuth tokens or API keys you provide                    | Calling your servers on your behalf; always encrypted  |
| Activity logs           | who, when, which tool, outcome, duration, client name   | Your activity timeline, admin audit, abuse prevention  |
| Technical logs          | request ids, errors, no personal data beyond ids        | Operating and debugging the service                    |
| Usage counters          | executions and tool calls per workspace and day         | Capacity planning and future pricing                   |

Sign-in codes, sign-in links and workspace invitations are sent by email through our email provider (see [sub-processors](/legal/sub-processors)); the codes and links are stored only hashed and expire after 10 minutes. We do not use third-party analytics, advertising or tracking. We only set technical cookies (see the [cookie policy](/legal/cookies)).

## Legal bases (GDPR)

- **Contract** (Art. 6(1)(b)): providing the service you signed up for.
- **Legitimate interests** (Art. 6(1)(f)): security, abuse prevention, activity logs, service improvement from aggregated usage counters.
- **Legal obligations** (Art. 6(1)(c)): where the law requires us to keep or disclose data.

## Controller and processor roles

For your account data we are the **controller**. For the content and personal data that pass through Toolkien when your agent uses your connectors, and for company workspaces, we act as a **processor** on behalf of the customer, under the [data processing agreement](/legal/dpa).

## Where data lives and who processes it

Servers and databases are in the European Union. The sub-processors we use are listed on the [sub-processors page](/legal/sub-processors). The MCP servers you connect are services you choose; data you send them is governed by their terms.

## How long we keep it

See the [data retention policy](/legal/retention). In short: activity logs 90 days, technical logs 14 days, paused execution state until the execution ends or expires, account data until you delete your account.

## Your rights

You can access, rectify, export and erase your data, restrict or object to processing, and lodge a complaint with your supervisory authority. Export and account deletion are self-service in **Settings → Account**. Deleting your account revokes upstream tokens where the provider allows it, deletes credentials and configuration, and anonymises your entries in the activity logs of company workspaces you were a member of. For anything else, write to **[privacy contact email]**.

## Security

See the [security overview](/legal/security) and the detailed [security documentation](/docs/security).

## Changes

We will announce material changes in the product and update the date above.
