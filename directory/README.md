# Toolkien directory

A community-maintained basket of **remote MCP servers**, preconfigured so they can be added to a Toolkien workspace in one click. Every server is one JSON file in [`servers/`](./servers), reviewed through pull requests.

What an entry gives Toolkien:

- the Streamable HTTP endpoint (`https` only) and how to authenticate (OAuth, pasted token, or none);
- the minimal OAuth scopes to request, when the server needs them;
- **verified tool annotations** (`readOnlyHint`, `destructiveHint`, …). Toolkien's default permissions depend on them: read-only tools of a directory server are allowed without asking, everything else asks for confirmation. Wrong annotations weaken that protection, so reviewers check them carefully;
- reviewer notes shown next to the tools, and who checked the entry and when.

Two separate facts describe an entry:

- **`publisher`** — who runs the server. `official`: the service's own vendor, on its own domain and documented by it (Linear's server for Linear). `community`: a third party serving a service it does not own. The app shows **Official** or **Community** ("maintained by a third party, not by <service>").
- **`verification.status`** — how far we checked it. `tested`: someone connected and inspected `tools/list`. `documented`: the endpoint matches the vendor's current docs and answers as expected (e.g. 401 with RFC 9728 metadata for OAuth servers). `needs-review`: something is uncertain, explained in `notes` (shown as a small **Needs review** badge).

Official entries that are `tested` or `documented` are trusted: agents see their descriptions as is, and read-only tools are allowed by default. Community and `needs-review` entries are handled like servers added from a free URL: their descriptions are flagged as untrusted and their permissions start from a proposal the user confirms. Servers added from a free URL that is not in this directory are marked **Unverified**; a URL that is exactly a directory endpoint (case and trailing slash ignored) is linked to its entry instead.

## Format

```jsonc
{
	"$schema": "../schema.json",
	"id": "linear", // = file name, kebab-case, never renamed
	"name": "Linear",
	"description": "Find, create and update Linear issues, projects, cycles and comments.",
	"homepage": "https://linear.app/docs/mcp",
	"url": "https://mcp.linear.app/mcp", // remote MCP endpoint, https only
	"namespace": "linear", // scripts call `linear.listIssues(...)`
	"publisher": "official", // "official" (run by the vendor) | "community" (third party)
	"category": "project-management",
	"tags": ["issues"],
	"auth": {
		"type": "oauth", // "oauth" | "token" | "none"
		"scopes": ["read"], // optional, minimal
		"oauth": { "registration": ["cimd", "dcr"] } // optional hints
		// for "token": "tokenHelp" and "tokenUrl"
	},
	"tools": {
		"list_issues": { "annotations": { "readOnlyHint": true }, "note": "Read only." }
	},
	"verification": {
		"status": "tested", // "tested" | "documented" | "needs-review"
		"by": "your-github-handle",
		"on": "2026-11-14",
		"notes": "How it was checked (required for needs-review)."
	}
}
```

The full schema is [`schema.json`](./schema.json), generated from the zod schema in `src/lib/server/connectors/directory-schema.ts`. Editors that understand `$schema` validate as you type.

## Validate

```sh
pnpm directory:validate          # checks every entry (also run by CI and `pnpm test`)
pnpm directory:validate --write  # regenerates schema.json after changing the zod schema
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) to propose a server.
