import type { HandleMcpRequest } from './types.ts';

export * from './types.ts';

export const handleMcpRequest: HandleMcpRequest = async () =>
	Response.json(
		{
			jsonrpc: '2.0',
			id: null,
			error: { code: -32601, message: 'MCP server not implemented yet' }
		},
		{ status: 501 }
	);
