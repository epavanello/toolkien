import { error } from '@sveltejs/kit';
import type { ConcurrencySnapshot } from './types.ts';

export type SlotLimits = { perUser: number; global: number; maxQueuedPerUser: number };

type Waiter = { userId: string; grant: () => void; reject: (reason: unknown) => void };

/**
 * Runner concurrency: at most `perUser` running executions per user and `global` overall; the
 * rest wait in a FIFO queue (a waiter is skipped while its user is at their limit, so one busy
 * user never blocks others). In memory, single instance.
 */
export class SlotPool {
	#running = new Map<string, number>();
	#total = 0;
	#queue: Waiter[] = [];

	constructor(private limits: () => SlotLimits) {}

	snapshot(): ConcurrencySnapshot {
		return { running: this.#total, queued: this.#queue.length, users: this.#running.size };
	}

	#canRun(userId: string) {
		const { perUser, global } = this.limits();
		return this.#total < global && (this.#running.get(userId) ?? 0) < perUser;
	}

	#take(userId: string): () => void {
		this.#total++;
		this.#running.set(userId, (this.#running.get(userId) ?? 0) + 1);
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#total--;
			const left = (this.#running.get(userId) ?? 1) - 1;
			if (left <= 0) this.#running.delete(userId);
			else this.#running.set(userId, left);
			this.#drain();
		};
	}

	#drain() {
		for (let i = 0; i < this.#queue.length;) {
			const waiter = this.#queue[i];
			if (this.#canRun(waiter.userId)) {
				this.#queue.splice(i, 1);
				waiter.grant();
			} else i++;
		}
	}

	acquire(userId: string, signal?: AbortSignal): Promise<() => void> {
		if (signal?.aborted) return Promise.reject(signal.reason);
		if (this.#canRun(userId)) return Promise.resolve(this.#take(userId));
		const queued = this.#queue.filter((waiter) => waiter.userId === userId).length;
		if (queued >= this.limits().maxQueuedPerUser) {
			return Promise.reject(
				(() => {
					try {
						error(429, 'Too many executions waiting. Try again shortly.', { code: 'RATE_LIMITED' });
					} catch (e) {
						return e;
					}
				})()
			);
		}
		return new Promise((resolve, reject) => {
			const waiter: Waiter = {
				userId,
				grant: () => {
					signal?.removeEventListener('abort', onAbort);
					resolve(this.#take(userId));
				},
				reject
			};
			const onAbort = () => {
				const index = this.#queue.indexOf(waiter);
				if (index >= 0) this.#queue.splice(index, 1);
				reject(signal!.reason);
			};
			signal?.addEventListener('abort', onAbort, { once: true });
			this.#queue.push(waiter);
		});
	}
}
