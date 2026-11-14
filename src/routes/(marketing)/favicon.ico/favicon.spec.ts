import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isRedirect } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { GET } from './+server.ts';

describe('/favicon.ico', () => {
	it('redirects permanently to a PNG icon that exists in static/', async () => {
		let thrown: unknown;
		try {
			await GET({} as Parameters<typeof GET>[0]);
		} catch (cause) {
			thrown = cause;
		}
		expect(isRedirect(thrown)).toBe(true);
		if (!isRedirect(thrown)) return;
		expect(thrown.status).toBe(301);
		expect(thrown.location).toBe('/icon-192.png');
		expect(existsSync(join(process.cwd(), 'static', thrown.location))).toBe(true);
	});
});
