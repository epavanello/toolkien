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
 * - Without `outputSchema` the return type is `Promise<ToolTextResult>` (`text`, `content`,
 *   `json()`, declared once per module and implemented by the sandbox prelude) and the JSDoc
 *   says so. With one, the structured result is typed from the schema.
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
	/** (additive) Connector display name and instance label, stated in the namespace JSDoc */
	connectorName?: string | null;
	instanceLabel?: string | null;
};

/** What the signature hash covers (descriptions and titles are not part of it) */
export type SignatureInput = Pick<ToolTypeInput, 'inputSchema' | 'outputSchema' | 'annotations'>;

export interface TypeGenerator {
	/** Declaration of one tool as a member of its namespace object */
	toolDeclaration(tool: ToolTypeInput): Promise<string>;
	/**
	 * Full `.d.ts` module for a set of tools (one `declare const` per namespace). (additive)
	 * `sharedTypes: false` leaves out `ToolTextResult` / `ContentBlock` when another module shown
	 * alongside already declares them.
	 */
	moduleDeclaration(tools: ToolTypeInput[], options?: { sharedTypes?: boolean }): Promise<string>;
	/** `search_threads` / `search-threads` / `SearchThreads` → `searchThreads` */
	toCamelCase(name: string): string;
	/**
	 * (additive) A namespace usable as `declare const`: camelCase, never a reserved word or a
	 * global the scripts rely on (`delete` → `deleteTools`).
	 */
	toNamespace(name: string): string;
	/**
	 * (additive) SHA-256 hex of the canonical JSON (sorted keys) of input schema, output schema
	 * and annotation hints. What permissions confirm.
	 */
	signatureHash(tool: SignatureInput): string;
}
