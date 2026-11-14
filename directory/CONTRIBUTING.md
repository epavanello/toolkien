# Contributing a server to the directory

Thanks for helping! One pull request per server (or per fix) keeps reviews quick.

## Propose a server

Not ready to write the entry? [Request a server](../../../issues/new?template=server-request.yml) instead: the issue form asks for the name, docs page, endpoint, authentication and who runs it.

1. Copy an existing file in [`servers/`](./servers) to `servers/<id>.json`. `id` is kebab-case and equal to the file name; it is stored in workspaces that install the server, so it is never renamed afterwards.
2. Fill in the fields (see [README.md](./README.md)). Use the vendor's **official** remote endpoint and documentation page; link it in `homepage`.
3. Add `tools` entries only for tools whose behaviour you checked. For each, set the annotations you are sure about and a short `note` when useful. Leave a tool out rather than guess: Toolkien then uses what the server reports, and treats tools without annotations as writes.
4. Set `publisher`: `official` when the service's vendor runs the server on its own domain and documents it, `community` for a third-party server (say who maintains it in `notes`).
5. Set `verification`: your GitHub handle, today's date, and how you checked. `tested` if you connected and inspected `tools/list` (public servers can be tested anonymously), `documented` if the endpoint matches the vendor's current docs and a probe answers as expected (an unauthenticated `initialize` gets 401 with `WWW-Authenticate` / resource metadata for OAuth servers, 200 for public ones), `needs-review` if something is still uncertain (say what in `notes`).
6. Run `pnpm directory:validate` and open the pull request.

## What reviewers check

- **Remote and https only.** The URL is a hosted Streamable HTTP endpoint (no stdio, no local commands, no `http://`, no credentials or API keys in the URL or query string). Legacy SSE-only endpoints are not accepted.
- **Honest publisher.** `official` only for endpoints the service's vendor runs and documents; everything else is `community`, with its maintainer named. No proxies or mirrors of an official server.
- **Annotation accuracy.** `readOnlyHint: true` only for tools that cannot change anything (no writes, sends, payments, deletes, side effects). `destructiveHint` for deletions and irreversible actions. When in doubt, no annotation: a wrong read-only hint lets a write run without confirmation.
- **Minimal scopes.** `auth.scopes` requests only what the tools need; prefer read-only scopes or omit scopes when the server's challenge selects them. For `token` servers, `tokenHelp` tells users to create a narrowly scoped (ideally read-only) token.
- **Honest verification.** Notes describe what was checked and anything uncertain; uncertain entries stay `needs-review`.
- **No tracking, logos or marketing copy.** Descriptions are one plain sentence about what the tools do.

Changes to an existing entry (URL moved, tools renamed, annotations corrected) follow the same checks; update `verification` with your handle and date.
