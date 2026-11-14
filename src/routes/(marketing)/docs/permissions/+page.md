---
title: Permissions & approvals
description: Allow, ask or block each tool; approve calls at runtime; admin floors that members cannot loosen.
updated: 2026-11-14
---

## Levels

Every tool has one of three levels, as in Claude and Codex:

| Level     | Effect                                                   |
| --------- | -------------------------------------------------------- |
| **Allow** | The call runs without asking.                            |
| **Ask**   | The execution pauses until you approve the call.         |
| **Block** | The call is refused, and the tool is hidden from search. |

## Defaults

| Source                                          | Annotation                 | Default                              |
| ----------------------------------------------- | -------------------------- | ------------------------------------ |
| Directory (official, tested or documented)      | `readOnlyHint: true`       | Allow                                |
| Directory (official, tested or documented)      | write or `destructiveHint` | Ask                                  |
| Directory (community or needs review), free URL | any                        | Proposed, you confirm on first setup |
| Any                                             | none                       | Treated as a write: Ask              |

Only directory entries published by the service's own vendor and checked by a maintainer get the defaults straight away; community-maintained entries, entries still under review and free URLs get the same rule as a proposal, and each tool behaves as **Ask** until you confirm it.

The bridge checks the level on **every call**, not only during discovery. When a tool's signature changes, an approved level goes back to _to confirm_ and the tool behaves as **Ask**.

## Admin floors

In company workspaces, admins set a minimum level for the whole workspace or per tool. Members can make permissions **stricter, never looser**. The effective level is the most restrictive of the defaults, the workspace floor, the per-tool floor and the member's own choice.

## Runtime approvals

- **With elicitation** (your client supports it): a dialog shows the connector, the tool, the main arguments and the workspace, with _approve this call_, _approve every call to this tool in this script_, or _reject_.
- **Without elicitation**: `execute` returns a link to the Toolkien approval page and a _waiting_ status; after you decide, the agent calls `execution_status` to resume.

Approvals come **only from a signed-in human**: there is no MCP tool that approves, and nothing the model sends counts as an approval. Owners and admins of a company workspace can also decide a member's pending approval; the log records who approved (the user, an admin, or the policy). Pending approvals expire after 30 minutes.
