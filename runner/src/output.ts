/** Output budget: result first, then logs, both within `maxOutputBytes`, with explicit notices. */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const byteLength = (text: string) => encoder.encode(text).length;

/** Cuts `text` to at most `max` UTF-8 bytes without splitting a character */
export function truncateBytes(text: string, max: number): string {
	const bytes = encoder.encode(text);
	if (bytes.length <= max) return text;
	return decoder.decode(bytes.subarray(0, Math.max(0, max))).replace(/�$/, '');
}

/** Collects log lines up to a byte budget, remembering whether anything was dropped */
export class LogBuffer {
	#lines: string[] = [];
	#bytes = 0;
	overflow = false;
	constructor(private readonly max: number) {}

	push(text: string) {
		if (this.overflow) return;
		const size = byteLength(text) + 1;
		if (this.#bytes + size > this.max) {
			const room = this.max - this.#bytes;
			if (room > 1) this.#lines.push(truncateBytes(text, room - 1));
			this.#bytes = this.max;
			this.overflow = true;
			return;
		}
		this.#lines.push(text);
		this.#bytes += size;
	}

	/** Logs within `budget` bytes (plus the notice when cut) */
	text(budget: number, limit: number): { logs: string; truncated: boolean } {
		const joined = this.#lines.join('\n');
		if (!this.overflow && byteLength(joined) <= budget) return { logs: joined, truncated: false };
		const cut = truncateBytes(joined, budget);
		return {
			logs: `${cut}${cut ? '\n' : ''}… [logs truncated: output limit is ${limit} bytes]`,
			truncated: true
		};
	}
}

/** Builds the `completed` output from the sandbox's final frame */
export function completedOutput(
	done: { json: string; size: number; truncated: boolean },
	logs: LogBuffer,
	maxOutputBytes: number
): { result: unknown; logs: string; truncated: boolean } {
	let result: unknown;
	let resultBytes: number;
	let truncated = false;
	const actualSize = byteLength(done.json);
	if (!done.truncated && actualSize <= maxOutputBytes) {
		try {
			result = JSON.parse(done.json);
		} catch {
			result = null;
		}
		resultBytes = actualSize;
	} else {
		const size = Math.max(done.size, actualSize);
		result = `${truncateBytes(
			done.json,
			maxOutputBytes
		)}… [result truncated: ${size} bytes, output limit is ${maxOutputBytes} bytes]`;
		resultBytes = maxOutputBytes;
		truncated = true;
	}
	const out = logs.text(Math.max(0, maxOutputBytes - resultBytes), maxOutputBytes);
	return { result, logs: out.logs, truncated: truncated || out.truncated };
}
