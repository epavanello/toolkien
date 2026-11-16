---
title: How it works
description: 'Code mode in Toolkien: search tools, read their TypeScript types, then run one sandboxed script.'
updated: 2026-11-14
---

## Why code mode

Classic MCP setups give the model every tool schema of every server up front. With a few servers that is hundreds of tools and tens of thousands of tokens, before the conversation starts. Toolkien exposes a short, fixed set of tools and lets the agent **discover** what it needs and **write code** against typed functions.

## The loop

### Search

`tools_search` takes a text query and returns tool **paths** with one line of description, for the active workspace only. Tools you blocked do not appear.

```text
github.listIssues     List issues of a repository
github.createIssue    Create an issue
slack.postMessage     Post a message to a channel
```

### Describe

`tools_describe` returns the TypeScript declarations of the paths the agent asks for, generated from each tool's input and output schemas. Descriptions become JSDoc; annotations such as `@readOnly` and `@destructive` are kept. Without an output schema the return type is `unknown`, and the JSDoc tells the agent to inspect the result.

```ts
declare namespace github {
	/**
	 * List issues of a repository
	 * @readOnly
	 */
	function listIssues(input: { repo: string; state?: 'open' | 'closed' }): Promise<Issue[]>;
}
```

### Execute

`execute` runs a TypeScript script. It is type-checked against the declarations first, so mistakes come back immediately. Then it runs in a fresh, permission-less Deno process: the script can only call the generated functions, and every call goes through the **bridge**, which checks permissions on each call, decrypts the credential in memory and calls the upstream server through the egress proxy.

```ts twoslash
type Issue = { number: number; title: string; state: 'open' | 'closed' };
declare namespace github {
	function listIssues(input: { repo: string; state?: 'open' | 'closed' }): Promise<Issue[]>;
}
declare namespace slack {
	function postMessage(input: { channel: string; text: string }): Promise<{ ts: string }>;
}
export {};
// ---cut---
const issues = await github.listIssues({ repo: 'acme/web', state: 'open' });
await slack.postMessage({ channel: '#triage', text: `${issues.length} open issues` });
```

The result and the `console.log` output come back to the agent, truncated with an explicit notice beyond the output limit (100 KB by default). Default limits: 120 s per execution, 200 tool calls.

## Pausing for approval

When a call needs your confirmation, the execution **pauses** and its state is saved encrypted in the database, so it survives restarts. When you approve, the script re-runs: calls that already completed return their cached result and **writes are never repeated**. Pending approvals expire after 30 minutes.

## One workspace per execution

The active workspace is chosen per connection (each approval of a client), at consent time or with `workspace_switch` (after your confirmation). An execution is bound to one workspace and can never mix tools from two. Search and execute results always name the workspace.

## Keeping definitions fresh

Definitions refresh when the server announces a change, at least once a day, when a call fails because a tool or its parameters changed (the error includes the new signature), and from the **Refresh** button. Each change is versioned; when a signature you approved changes, the tool goes back to _to confirm_.
