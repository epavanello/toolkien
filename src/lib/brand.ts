/**
 * Product name and taglines, in one place so a rename touches a single file.
 * Brand guardrails (docs/brand.md): the pun and an original ring/forge motif are ours; nothing
 * from Tolkien's works or the films (characters, names, maps, inscriptions, rune fonts).
 */
export const brand = {
	name: 'Toolkien',
	tagline: 'One MCP to rule them all.',
	alternates: ['Connect once. Call them all.', 'One tool to find them, one sandbox to run them.']
} as const;

/** Source repository (placeholder until the public repo exists); the app and the site link it */
export const REPOSITORY_URL = 'https://github.com/epavanello/toolkien';
