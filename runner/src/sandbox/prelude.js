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
// Captured before the script runs: the script may replace prototypes and globals, which must
// not change how frames are built (it can only ever affect its own values)
const apply = Reflect.apply;
const encode = TextEncoder.prototype.encode;
const decode = TextDecoder.prototype.decode;
const write = Object.getPrototypeOf(stdout).write;
const read = Object.getPrototypeOf(stdinReader).read;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapDelete = Map.prototype.delete;
const stringSlice = String.prototype.slice;
const stringIndexOf = String.prototype.indexOf;
const byteLength = (text) => apply(encode, encoder, [text]).length;

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
	'prompt',
	// Unneeded web platform surface (no permission would let them do anything, but less is less)
	'Navigator',
	'NavigatorUAData',
	'Location',
	'location',
	'Storage',
	'CacheStorage',
	'Cache',
	'LockManager',
	'Lock',
	'OffscreenCanvas',
	'createImageBitmap',
	'ImageBitmap',
	'ImageBitmapRenderingContext',
	...Object.getOwnPropertyNames(globalThis).filter((name) => name.startsWith('GPU'))
]) {
	try {
		delete globalThis[name];
	} catch {
		// non-configurable: still denied by the permission system
	}
}

/**
 * Frames are assembled from primitives (JSON text of strings and numbers ignores `toJSON`), so a
 * script that pollutes `Object.prototype` cannot rewrite them.
 */
let writeChain = Promise.resolve();
function sendText(json) {
	const bytes = apply(encode, encoder, [json + '\n']);
	const previous = writeChain;
	writeChain = new Promise((resolve) => {
		const step = async () => {
			try {
				await previous;
			} catch {
				// keep writing
			}
			let offset = 0;
			while (offset < bytes.length) {
				offset += await apply(write, stdout, [bytes.subarray(offset)]);
			}
		};
		step().then(resolve, resolve);
	});
	return writeChain;
}
const str = (value) => stringify(String(value));

class ToolCallError extends Error {
	constructor(code, message, path) {
		super(`${path} failed [${code}]: ${message}`);
		this.name = 'ToolCallError';
		this.code = code;
		this.path = path;
	}
}
Object.defineProperty(globalThis, 'ToolCallError', { value: ToolCallError, enumerable: false });

let nextId = 1;
const pending = new Map();

async function readReplies() {
	let buffer = '';
	for (;;) {
		const { value, done } = await apply(read, stdinReader, []);
		if (done) return;
		buffer += apply(decode, decoder, [value, { stream: true }]);
		let newline;
		while ((newline = apply(stringIndexOf, buffer, ['\n'])) >= 0) {
			const line = apply(stringSlice, buffer, [0, newline]);
			buffer = apply(stringSlice, buffer, [newline + 1]);
			if (!line) continue;
			const message = parse(line);
			const waiter = apply(mapGet, pending, [message.id]);
			if (!waiter) continue;
			apply(mapDelete, pending, [message.id]);
			if (message.ok) waiter.resolve(message.value);
			else {
				const error = new ToolCallError(message.code, message.message, waiter.path);
				// The stack of the call site in the script, not of this reader loop
				const site = safe(() => waiter.site.stack, '');
				const at = apply(stringIndexOf, site, ['\n']);
				if (at >= 0)
					error.stack = `${error.name}: ${error.message}${apply(stringSlice, site, [at])}`;
				waiter.reject(error);
			}
		}
	}
}

let maxArgsBytes = Infinity;
function callTool(path, args) {
	let json;
	try {
		json = args === undefined ? '{}' : stringify(args);
		if (json === undefined) throw new TypeError();
		// Normalises what the script passed (drops functions, undefined, …) like the app will
		json = stringify(parse(json));
	} catch {
		return Promise.reject(new TypeError(`Arguments of ${path} must be JSON-serialisable.`));
	}
	const size = byteLength(json);
	if (size > maxArgsBytes) {
		return Promise.reject(
			new RangeError(
				`Arguments of ${path} are ${size} bytes, over the ${maxArgsBytes}-byte limit for one tool call. Send less data per call.`
			)
		);
	}
	const id = nextId++;
	const site = new Error();
	return new Promise((resolve, reject) => {
		apply(mapSet, pending, [id, { resolve, reject, path, site }]);
		sendText(`{"t":"call","id":${id},"path":${str(path)},"args":${json}}`);
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
			let text = prefix + format(args);
			// One huge line must not exceed the frame limit: keep what fits the remaining budget
			if (text.length > logBudget) text = apply(stringSlice, text, [0, logBudget]);
			logBudget -= byteLength(text) + 1;
			sendText(`{"t":"log","text":${str(text)}}`);
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
async function finish(json) {
	if (finished) return;
	finished = true;
	await sendText(json);
	// The supervisor kills the process once it has the final frame; never linger on timers
	await new Promise(() => {});
}

/** Reads a property of a thrown value without letting getters or proxies break the report */
function safe(read, fallback) {
	try {
		const value = read();
		return value === undefined || value === null ? fallback : String(value);
	} catch {
		return fallback;
	}
}

/** `error` frame: name, message, stack (mapped to script.ts by the inline source map), tool info */
function errorFrame(error) {
	const MAX = 16 * 1024;
	const cut = (text) => (text.length > MAX ? apply(stringSlice, text, [0, MAX]) : text);
	let name;
	let message;
	let stack = '';
	let extra = '';
	if (error instanceof Error) {
		name = safe(() => error.name, 'Error');
		message = safe(() => error.message, '');
		stack = safe(() => error.stack, '');
		if (error instanceof ToolCallError) {
			extra = `,"code":${str(safe(() => error.code, ''))},"path":${str(safe(() => error.path, ''))}`;
		}
	} else {
		message = safe(
			() => (typeof error === 'string' ? error : inspect(error, { depth: 2, colors: false })),
			'Unknown error'
		);
		name = 'Thrown value';
	}
	return `{"t":"error","name":${str(cut(name))},"message":${str(cut(message))},"stack":${str(cut(stack))}${extra}}`;
}

/**
 * @param {() => Promise<unknown>} main
 * @param {{ namespaces: string[]; maxOutputBytes: number }} options
 */
export async function run(main, options) {
	logBudget = options.maxOutputBytes;
	// Leave room for the frame envelope under the supervisor's message limit
	if (options.maxMessageBytes) maxArgsBytes = options.maxMessageBytes - 1024;
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
	readReplies().catch(() =>
		finish('{"t":"error","name":"Error","message":"Protocol error.","stack":""}')
	);
	try {
		const value = await main();
		let json;
		try {
			json = value === undefined ? 'null' : stringify(value);
			if (json === undefined) json = 'null';
		} catch (cause) {
			throw new TypeError(
				`The script result must be JSON-serialisable (${safe(() => cause.message, 'stringify failed').replace(/\s*\n\s*/g, ' ')}). Return plain objects, arrays, strings, numbers or booleans.`,
				{ cause }
			);
		}
		const size = byteLength(json);
		const truncated = size > options.maxOutputBytes;
		if (truncated) json = apply(stringSlice, json, [0, options.maxOutputBytes]);
		await finish(`{"t":"done","json":${str(json)},"size":${size},"truncated":${truncated}}`);
	} catch (error) {
		await finish(errorFrame(error));
	}
}
