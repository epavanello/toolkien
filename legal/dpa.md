---
title: Data processing agreement
description: How Toolkien processes personal data on behalf of customers (GDPR Art. 28).
updated: 2026-11-14
---

> **Draft generated automatically: to be reviewed by a lawyer or DPO before publication.** This text is not legal advice.

This Data Processing Agreement ("DPA") forms part of the [terms of service](/legal/terms) between the customer ("Controller") and **[Operator legal name]** ("Processor") for the managed Toolkien service. It does not apply to self-hosted instances, whose operators act as controller or processor themselves.

## 1. Subject matter and duration

The Processor processes personal data on behalf of the Controller to provide the Service: relaying calls between the Controller's AI clients and the MCP servers the Controller connects, running scripts in a sandbox, and keeping metadata logs. Processing lasts as long as the Controller uses the Service, plus the retention periods in the [retention policy](/legal/retention).

## 2. Nature and purpose

Transit of tool arguments and results (in memory, not stored), temporary encrypted storage of paused executions, encrypted storage of upstream credentials, and metadata logging (who, when, which tool, outcome, duration).

## 3. Categories of data subjects and data

Data subjects: the Controller's workspace members and any person whose data appears in the content that flows through the connectors chosen by the Controller. Data: account identifiers of members, metadata logs, and whatever personal data the Controller's connected services return to its agents.

## 4. Processor obligations

The Processor:

- processes personal data only on documented instructions of the Controller (these terms, the product configuration, and the Controller's use of the Service);
- ensures that authorised personnel are bound by confidentiality;
- implements the technical and organisational measures described in the [security documentation](/docs/security), including envelope encryption of credentials, sandboxed execution, network isolation, egress control and metadata-only logging;
- assists the Controller with data subject requests (self-service export and deletion are available) and with security, breach notification, impact assessments and consultations;
- notifies the Controller without undue delay, and where possible within 48 hours, after becoming aware of a personal data breach;
- deletes or returns personal data at the end of the Service, subject to the retention policy and backups that expire on their own schedule;
- makes available the information necessary to demonstrate compliance and allows audits, reasonably scheduled and at the Controller's expense.

## 5. Sub-processors

The Controller authorises the sub-processors listed on the [sub-processors page](/legal/sub-processors). The Processor will announce changes at least **[30] days** in advance; the Controller may object on reasonable grounds and, failing agreement, terminate.

## 6. International transfers

Data is hosted in the European Union. Any transfer outside the EEA relies on an adequacy decision or the Standard Contractual Clauses.

## 7. Contact

**[DPO or privacy contact email]**
