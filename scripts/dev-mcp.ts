/**
 * Development only: a local MCP server (Streamable HTTP, no auth) for testing connectors,
 * `tools_search` and `execute` without real upstream accounts. The seeded "Dev MCP" connector
 * points here (development accepts `http://localhost…` connector URLs).
 *
 *   pnpm dev:mcp            # http://localhost:8788/mcp  (DEV_MCP_PORT to change)
 */
import { createServer, type IncomingMessage } from 'node:http';
import { createMcpHandler, ProtocolError, Server } from '@modelcontextprotocol/server';
import { DEV_MCP_PORT, DEV_TOOLS } from './dev-mcp-tools.ts';

type Note = { id: string; title: string; body: string };
const notes = new Map<string, Note>([
	['n1', { id: 'n1', title: 'Welcome', body: 'Seeded note from the dev MCP server.' }]
]);
let nextId = 2;

const text = (value: string) => ({ content: [{ type: 'text', text: value }] });
const structured = (value: Record<string, unknown>) => ({
	content: [{ type: 'text', text: JSON.stringify(value) }],
	structuredContent: value
});

function call(name: string, args: Record<string, unknown>) {
	switch (name) {
		case 'echo':
			return text(String(args.text ?? ''));
		case 'add_numbers':
			return structured({ sum: Number(args.a) + Number(args.b) });
		case 'list_notes':
			return structured({ notes: [...notes.values()] });
		case 'create_note': {
			const created = { id: `n${nextId++}`, title: String(args.title), body: String(args.body) };
			notes.set(created.id, created);
			return structured(created);
		}
		case 'delete_note':
			return notes.delete(String(args.id))
				? text(`Deleted ${args.id}`)
				: { ...text(`No note ${args.id}`), isError: true };
		case 'fail':
			return { ...text(String(args.message ?? 'Failed on purpose')), isError: true };
		default:
			throw new ProtocolError(-32602, `Unknown tool: ${name}`);
	}
}

const handler = createMcpHandler(
	() => {
		const server = new Server(
			{ name: 'toolkien-dev-mcp', version: '1.0.0' },
			{ capabilities: { tools: { listChanged: false } } }
		);
		server.setRequestHandler('tools/list', async () => ({ tools: DEV_TOOLS as never }));
		server.setRequestHandler('tools/call', async (request) => {
			const { name, arguments: args = {} } = request.params as {
				name: string;
				arguments?: Record<string, unknown>;
			};
			console.info(`[dev-mcp] ${name} ${JSON.stringify(args)}`);
			return call(name, args) as never;
		});
		return server;
	},
	{ legacy: 'stateless' }
);

async function toRequest(req: IncomingMessage): Promise<Request> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(chunk as Buffer);
	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers)) {
		if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value);
	}
	const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
	return new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
		method: req.method,
		headers,
		body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body
	});
}

createServer(async (req, res) => {
	try {
		const path = new URL(req.url ?? '/', 'http://localhost').pathname;
		const response =
			path === '/mcp'
				? await handler.fetch(await toRequest(req))
				: new Response('Not found', { status: 404 });
		res.writeHead(response.status, Object.fromEntries(response.headers));
		if (!response.body) return void res.end();
		for await (const chunk of response.body) res.write(chunk);
		res.end();
	} catch (err) {
		console.error('[dev-mcp]', err);
		if (!res.headersSent) res.writeHead(500);
		res.end();
	}
}).listen(DEV_MCP_PORT, '127.0.0.1', () => {
	console.info(`[dev-mcp] listening on http://localhost:${DEV_MCP_PORT}/mcp`);
});
