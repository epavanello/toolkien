import type { ToolAnnotations } from '#lib/server/db/schema/connectors.ts';

/**
 * Operation type of an upstream tool, from its MCP annotations. The single classification for
 * every tool list (connector panel, permissions page), shown as group headers by `ToolGroupList`.
 */
export type ToolGroupKey = 'read' | 'write' | 'destructive' | 'unannotated';

export type ToolGroup = { key: ToolGroupKey; title: string; description: string };

/** Tool groups by MCP annotation, in reading order, with what each means for an agent */
export const toolGroups: ToolGroup[] = [
	{ key: 'read', title: 'Read only', description: 'Only read data, change nothing' },
	{ key: 'write', title: 'Write', description: 'Create or change data' },
	{ key: 'destructive', title: 'Destructive', description: 'May delete or overwrite data' },
	{
		key: 'unannotated',
		title: 'Not declared',
		description: 'The server does not say: treated as write'
	}
];

/**
 * Which group a tool falls in, with the same rule as the permission defaults
 * (`server/permissions/resolve.ts`). The hints come from the server itself, unverified.
 */
export function toolGroup(annotations: ToolAnnotations | null): ToolGroupKey {
	if (!annotations) return 'unannotated';
	if (annotations.destructiveHint === true) return 'destructive';
	if (annotations.readOnlyHint === true) return 'read';
	return 'write';
}

/** Non-empty groups of `items` in `toolGroups` order, keeping the order of items inside a group */
export function groupTools<T>(
	items: T[],
	annotations: (item: T) => ToolAnnotations | null
): (ToolGroup & { items: T[] })[] {
	return toolGroups
		.map((group) => ({
			...group,
			items: items.filter((item) => toolGroup(annotations(item)) === group.key)
		}))
		.filter((group) => group.items.length > 0);
}
