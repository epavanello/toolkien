// Runs inside the sandbox as plain JavaScript (no type-check, no emit cache)
/**
 * Sandbox bootstrap, imported by `entry.js` before the script module is evaluated.
 *
 * The process runs with no `--allow-*` flag and `--disallow-code-generation-from-strings`, so this
 * file is hardening and plumbing, not the security boundary:
 * - grabs stdin/stdout and `Deno.inspect`, then removes `Deno`, `Worker` and the network
 *   globals, so the script cannot write raw protocol frames or spawn module loaders;
 * - exposes each tool namespace as a Proxy whose functions send a JSON-RPC call on stdout
 *   and wait for the supervisor's answer on stdin;
 * - captures `console.*` (budgeted at `maxOutputBytes`), then reports the result or the error.
 * Everything it sends is validated again by the supervisor.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const stdout = Deno.stdout;
const stdinReader = Deno.stdin.readable.getReader();
const inspect = Deno.inspect;
const stringify = JSON.stringify;
const parse = JSON.parse;

for (const name of [
	'Deno',
	'Worker',
	'process',
	'fetch',
	'WebSocket',
	'WebSocketStream',
	'EventSource',
	'BroadcastChannel',
	'caches',
	'localStorage',
	'sessionStorage',
	'navigator',
	'close',
	'alert',
	'confirm',
	'prompt'
]) {
	try {
		delete globalThis[name];
	} catch {
		// non-configurable: still denied by the permission system
	}
}

let writeChain = Promise.resolve();
function send(message) {
	const bytes = encoder.encode(stringify(message) + '\n');
	writeChain = writeChain.then(async () => {
		let offset = 0;
		while (offset < bytes.length) offset += await stdout.write(bytes.subarray(offset));
	});
	return writeChain;
}

class ToolCallError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'ToolCallError';
		this.code = code;
	}
}
Object.defineProperty(globalThis, 'ToolCallError', { value: ToolCallError, enumerable: false });

let nextId = 1;
const pending = new Map();

async function readReplies() {
	let buffer = '';
	for (;;) {
		const { value, done } = await stdinReader.read();
		if (done) return;
		buffer += decoder.decode(value, { stream: true });
		let newline;
		while ((newline = buffer.indexOf('\n')) >= 0) {
			const line = buffer.slice(0, newline);
			buffer = buffer.slice(newline + 1);
			if (!line) continue;
			const message = parse(line);
			const waiter = pending.get(message.id);
			if (!waiter) continue;
			pending.delete(message.id);
			if (message.ok) waiter.resolve(message.value);
			else waiter.reject(new ToolCallError(message.code, message.message));
		}
	}
}

function callTool(path, args) {
	let payload;
	try {
		payload = args === undefined ? {} : parse(stringify(args));
	} catch {
		return Promise.reject(new TypeError(`Arguments of ${path} must be JSON-serialisable.`));
	}
	const id = nextId++;
	return new Promise((resolve, reject) => {
		pending.set(id, { resolve, reject });
		send({ t: 'call', id, path, args: payload });
	});
}

function namespace(name) {
	return new Proxy(Object.create(null), {
		get(_target, property) {
			if (typeof property !== 'string' || property === 'then') return undefined;
			return (args) => callTool(`${name}.${property}`, args);
		},
		set: () => false,
		defineProperty: () => false
	});
}

let logBudget = 0;
function captureConsole() {
	const format = (args) =>
		args
			.map((a) =>
				typeof a === 'string' ? a : inspect(a, { depth: 6, colors: false, iterableLimit: 200 })
			)
			.join(' ');
	const emit =
		(prefix) =>
		(...args) => {
			if (logBudget <= 0) return;
			const text = prefix + format(args);
			logBudget -= encoder.encode(text).length + 1;
			send({ t: 'log', text });
		};
	const log = emit('');
	globalThis.console = Object.freeze({
		log,
		info: log,
		debug: log,
		trace: log,
		dir: (item) => log(item),
		table: (data) => log(data),
		warn: emit('[warn] '),
		error: emit('[error] ')
	});
}

let finished = false;
async function finish(message) {
	if (finished) return;
	finished = true;
	await send(message);
	// The supervisor kills the process once it has the final frame; never linger on timers
	await new Promise(() => {});
}

function errorFrame(error) {
	if (error instanceof Error) {
		return { t: 'error', name: error.name || 'Error', message: String(error.message) };
	}
	let message;
	try {
		message = typeof error === 'string' ? error : inspect(error, { depth: 2, colors: false });
	} catch {
		message = 'Unknown error';
	}
	return { t: 'error', name: 'Error', message };
}

/**
 * @param {() => Promise<unknown>} main
 * @param {{ namespaces: string[]; maxOutputBytes: number }} options
 */
export async function run(main, options) {
	logBudget = options.maxOutputBytes;
	captureConsole();
	for (const name of options.namespaces) {
		Object.defineProperty(globalThis, name, {
			value: namespace(name),
			writable: false,
			configurable: false,
			enumerable: false
		});
	}
	globalThis.addEventListener('unhandledrejection', (event) => {
		event.preventDefault();
		finish(errorFrame(event.reason));
	});
	globalThis.addEventListener('error', (event) => {
		event.preventDefault();
		finish(errorFrame(event.error));
	});
	readReplies().catch(() => finish({ t: 'error', name: 'Error', message: 'Protocol error.' }));
	try {
		const value = await main();
		let json;
		try {
			json = value === undefined ? 'null' : stringify(value);
			if (json === undefined) json = 'null';
		} catch {
			throw new TypeError('The script result must be JSON-serialisable.');
		}
		const size = encoder.encode(json).length;
		const truncated = size > options.maxOutputBytes;
		if (truncated) json = json.slice(0, options.maxOutputBytes);
		await finish({ t: 'done', json, size, truncated });
	} catch (error) {
		await finish(errorFrame(error));
	}
}
