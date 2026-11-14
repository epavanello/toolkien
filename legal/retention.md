---
title: Data retention
description: How long the managed Toolkien service keeps each kind of data.
updated: 2026-11-14
---

> **Draft generated automatically: to be reviewed by a lawyer or DPO before publication.** This text is not legal advice.

Toolkien keeps the minimum needed to run the service. Content that flows through it (tool arguments, tool results, script code) is not stored, except encrypted while an execution is paused.

| Data                                     | Kept for                                                                                                    | Then                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Tool arguments, results, script code     | Only in memory during an execution                                                                          | Gone when the execution ends                                                                    |
| Paused execution state (encrypted)       | Until the execution completes, fails or is cancelled; pending approvals expire after 30 minutes             | Wiped                                                                                           |
| Approval previews (encrypted)            | Until the approval is decided or expires                                                                    | Wiped                                                                                           |
| Activity logs (metadata only)            | 90 days (configurable by the operator)                                                                      | Deleted by a daily job                                                                          |
| Technical server logs (ids only)         | 14 days                                                                                                     | Rotated out                                                                                     |
| Upstream credentials (encrypted)         | Until you remove the connector, leave the workspace or delete your account                                  | Deleted, revoked upstream where possible                                                        |
| Sign-in sessions                         | Until they expire or you sign out                                                                           | Deleted                                                                                         |
| MCP client tokens                        | Access tokens 15 minutes, refresh tokens 30 days (rotated)                                                  | Expired                                                                                         |
| Invite links (hashed)                    | Up to 30 days, or until revoked or used up                                                                  | Kept as inactive records with the workspace                                                     |
| Usage counters (per workspace and day)   | While the workspace exists                                                                                  | Deleted with the workspace                                                                      |
| Company workspace scheduled for deletion | 7-day grace period                                                                                          | Everything deleted                                                                              |
| Account                                  | Until you delete it                                                                                         | Personal and solely-owned workspaces deleted; your entries in other workspaces' logs anonymised |
| Backups                                  | Database point-in-time restore window (**[per Turso plan]**) and daily encrypted exports kept **[30] days** | Expire on their own schedule                                                                    |

Encryption keys live in OpenBao, separate from the database and its backups.

Self-hosted instances follow their operator's configuration (`AUDIT_RETENTION_DAYS` and the platform admin panel).
