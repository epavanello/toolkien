/**
 * Development only: the tools of the local MCP server (`scripts/dev-mcp.ts`). The seed
 * (`scripts/seed.ts`) registers the same definitions, so a seeded connector is already synced
 * and a manual "Sync" in the UI changes nothing.
 */
import type { JsonSchema, ToolAnnotations } from '../src/lib/server/db/schema/index.ts';

export const DEV_MCP_PORT = Number(process.env.DEV_MCP_PORT || 8788);
export const DEV_MCP_URL = `http://localhost:${DEV_MCP_PORT}/mcp`;

export type DevTool = {
	name: string;
	title: string;
	description: string;
	inputSchema: JsonSchema;
	outputSchema?: JsonSchema;
	annotations?: ToolAnnotations;
};

const note = {
	type: 'object',
	properties: {
		id: { type: 'string' },
		title: { type: 'string' },
		body: { type: 'string' }
	},
	required: ['id', 'title', 'body']
};

export const DEV_TOOLS: DevTool[] = [
	{
		name: 'echo',
		title: 'Echo',
		description: 'Returns the text it receives.',
		inputSchema: {
			type: 'object',
			properties: { text: { type: 'string', description: 'Text to echo back' } },
			required: ['text']
		},
		annotations: { readOnlyHint: true, openWorldHint: false }
	},
	{
		name: 'add_numbers',
		title: 'Add numbers',
		description: 'Adds two numbers and returns the sum as structured content.',
		inputSchema: {
			type: 'object',
			properties: { a: { type: 'number' }, b: { type: 'number' } },
			required: ['a', 'b']
		},
		outputSchema: {
			type: 'object',
			properties: { sum: { type: 'number' } },
			required: ['sum']
		},
		annotations: { readOnlyHint: true, openWorldHint: false }
	},
	{
		name: 'list_notes',
		title: 'List notes',
		description: 'Lists the notes kept in memory by the dev server.',
		inputSchema: { type: 'object', properties: {} },
		outputSchema: {
			type: 'object',
			properties: { notes: { type: 'array', items: note } },
			required: ['notes']
		},
		annotations: { readOnlyHint: true, openWorldHint: false }
	},
	{
		name: 'create_note',
		title: 'Create note',
		description: 'Creates a note (in memory, lost when the dev server stops).',
		inputSchema: {
			type: 'object',
			properties: { title: { type: 'string' }, body: { type: 'string' } },
			required: ['title', 'body']
		},
		outputSchema: note,
		annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
	},
	{
		name: 'delete_note',
		title: 'Delete note',
		description: 'Deletes a note by id. Destructive: useful to test "ask" approvals.',
		inputSchema: {
			type: 'object',
			properties: { id: { type: 'string' } },
			required: ['id']
		},
		annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
	},
	{
		name: 'fail',
		title: 'Fail',
		description: 'Always returns a tool error with the given message.',
		inputSchema: {
			type: 'object',
			properties: { message: { type: 'string' } }
		},
		annotations: { readOnlyHint: true, openWorldHint: false }
	}
];
