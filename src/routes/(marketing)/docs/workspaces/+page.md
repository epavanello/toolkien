---
title: Workspaces & roles
description: Personal and company workspaces, roles, invite links, admin policy, deletion and switching workspaces from your client.
updated: 2026-11-14
---

## Personal and company workspaces

Every account has a **personal workspace**. Create a **company workspace** from **Settings** to share connectors with a team: admins configure shared connectors once and members inherit them.

## Roles

| Role       | Can                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Owner**  | Everything, including deleting the workspace and transferring ownership                                                        |
| **Admin**  | Manage members, invite links, shared connectors, the permission policy, the kill switch; see everyone's activity and export it |
| **Member** | Use allowed connectors, add personal connectors if the policy allows it, see their own activity                                |

Owners and admins of company workspaces must use a **passkey**. It is checked when someone becomes an admin or owner and before every admin action, so an admin who removes their second factor loses admin powers until they add one again.

## Invite links

Toolkien sends no email. Admins create **invite links** with a role, an optional email restriction, a maximum number of uses and an expiry (up to 30 days), and share them however they like. A link is shown once; only its hash is stored. Links can be revoked at any time. Joining as an admin requires a second factor.

## Admin policy

- **Allowed servers**: directory ids or `https` origins members may connect (empty: all).
- **Personal connectors**: whether members may add connectors only for themselves.
- **Free URLs**: whether servers outside the directory are allowed.
- **Permission floor**: a minimum level for every tool.

## Switching workspace from your client

Each MCP client has one connection and one **active workspace**, chosen on the consent screen. The agent can call `workspace_switch` only when you ask for it, and the switch needs your confirmation; it is recorded in the activity log.

## Leaving, transferring, deleting

Members can leave a workspace; their own connectors and credentials there are deleted. The owner can **transfer ownership** to a member with a second factor. Only the owner can **delete** a company workspace: after typing its slug, executions stop at once and everything is deleted after a **7-day grace period**, during which the owner can cancel.

## Activity

**Activity** shows a timeline grouped by execution, filterable by connector, outcome, period and (for admins) member. Admins can export it as CSV. Logs hold metadata only and are kept 90 days.
