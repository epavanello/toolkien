import type { JsonSchema, ToolAnnotations } from '#lib/server/db/schema/index.ts';

/**
 * MCP tool schema → TypeScript declarations (owner: connectors).
 *
 * - Tools are grouped by connector namespace: `declare const gmail: { searchThreads(args: …):
 *   Promise<…> }`, so scripts call `await gmail.searchThreads({ query })`.
 * - Names are camelCase; `path` uniqueness inside a workspace is decided by the connectors
 *   module (collisions get the connector prefix) before calling typegen.
 * - Descriptions become JSDoc; annotations become `@readOnly` / `@destructive` / `@idempotent`
 *   / `@openWorld` tags. Unverified connectors get an `@unverified` tag and a warning line.
 * - Without `outputSchema` the return type is `Promise<unknown>` and the JSDoc tells the agent
 *   to inspect the result.
 * - Output is deterministic (same input → same text) so it can be cached and hashed.
 * - Upstream text is untrusted: it must be escaped so it can never close a comment (`*\/`)
 *   or inject declarations.
 */
export type ToolTypeInput = {
	/** `namespace.functionName` */
	path: string;
	namespace: string;
	functionName: string;
	title?: string | null;
	description?: string | null;
	inputSchema: JsonSchema;
	outputSchema?: JsonSchema | null;
	annotations?: ToolAnnotations | null;
	unverified: boolean;
};

export interface TypeGenerator {
	/** Declaration of one tool as a member of its namespace object */
	toolDeclaration(tool: ToolTypeInput): Promise<string>;
	/** Full `.d.ts` module for a set of tools (one `declare const` per namespace) */
	moduleDeclaration(tools: ToolTypeInput[]): Promise<string>;
	/** `search_threads` / `search-threads` / `SearchThreads` → `searchThreads` */
	toCamelCase(name: string): string;
}
