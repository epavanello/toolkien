/**
 * A tool call outlives its client (from devmotion). When the client hangs up mid-`execute`, the
 * script keeps running (its writes are durable and audited like any other) and only its answer
 * is dropped: the SDK gets the request without the client's abort signal, and its response
 * stream is read to the end even after ours is cancelled, so nothing writes into a closed
 * stream or tears the execution down half-way.
 */

/** The same request, no longer aborted when the client disconnects */
export function withoutClientAbort(request: Request): Request {
	return new Request(request, { signal: null });
}

async function drain(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
	try {
		while (!(await reader.read()).done);
	} catch {
		// The handler failed after the client left: nobody is there to tell
	}
}

/**
 * A stream relaying `body` that, once cancelled by the server (the client hung up), keeps
 * reading `body` to its end instead of cancelling it.
 */
export function drainOnCancel(
	body: ReadableStream<Uint8Array> | null
): ReadableStream<Uint8Array> | null {
	if (!body) return null;
	const reader = body.getReader();
	let isCancelled = false;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			const { done, value } = await reader.read();
			if (isCancelled) return;
			if (done) controller.close();
			else controller.enqueue(value);
		},
		cancel() {
			isCancelled = true;
			void drain(reader);
		}
	});
}
