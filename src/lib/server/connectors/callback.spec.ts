import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { handleOAuthCallback, OAuthCallbackError, withOAuthResult } from './callback.ts';

const RETURN_TO = '/w/acme/connectors?connector=c1';

type Deps = Parameters<typeof handleOAuthCallback>[2];

function setup(overrides: Partial<Pick<Deps, 'complete' | 'abandon'>> = {}) {
	const deps = {
		complete: vi.fn<Deps['complete']>(async () => ({ returnTo: RETURN_TO })),
		abandon: vi.fn<Deps['abandon']>(async () => RETURN_TO),
		...overrides,
		log: vi.fn<NonNullable<Deps['log']>>()
	};
	const run = (query: string) => handleOAuthCallback(new URLSearchParams(query), 'u1', deps);
	return { deps, run };
}

const httpFailure = async (promise: Promise<unknown>) => {
	try {
		await promise;
	} catch (cause) {
		if (isHttpError(cause)) return { status: cause.status, message: cause.body.message };
		throw cause;
	}
	return null;
};

describe('upstream OAuth callback', () => {
	it('goes back to the connector with oauth=connected', async () => {
		const { run, deps } = setup();
		expect(await run('state=s&code=abc&iss=https%3A%2F%2Fas.example')).toBe(
			'/w/acme/connectors?connector=c1&oauth=connected'
		);
		expect(deps.complete).toHaveBeenCalledWith('s', 'abc', {
			userId: 'u1',
			iss: 'https://as.example'
		});
	});

	it('maps the provider error to a code, never echoing its description', async () => {
		const { run, deps } = setup();
		const denied = await run('state=s&error=access_denied&error_description=Nope%20%3Cb%3E');
		expect(denied).toBe('/w/acme/connectors?connector=c1&oauth=denied');
		expect(await run('state=s&error=server_error&error_description=boom')).toBe(
			'/w/acme/connectors?connector=c1&oauth=provider_error'
		);
		expect(await run('state=s')).toMatch(/oauth=provider_error$/);
		expect(deps.abandon).toHaveBeenCalledWith('s', 'u1');
		expect(deps.log.mock.calls.flat()).toEqual(['denied', 'provider_error', 'provider_error']);
	});

	it('turns recoverable failures into their code and the way back', async () => {
		for (const code of [
			'expired',
			'exchange_failed',
			'unreachable',
			'removed',
			'failed'
		] as const) {
			const { run, deps } = setup({
				complete: vi.fn(async () => {
					throw new OAuthCallbackError(code, RETURN_TO);
				})
			});
			expect(await run('state=s&code=abc')).toBe(`${RETURN_TO}&oauth=${code}`);
			expect(deps.log).toHaveBeenCalledWith(code);
		}
	});

	it('falls back to an error page only when nothing is recoverable', async () => {
		expect(await httpFailure(setup().run('code=abc'))).toMatchObject({ status: 400 });
		const unknown = setup({ abandon: vi.fn(async () => null) });
		expect(await httpFailure(unknown.run('state=s&error=access_denied'))).toMatchObject({
			status: 400,
			message: expect.stringContaining('Connect again')
		});
	});

	it('lets other errors through (HTTP errors render the error page)', async () => {
		const boom = new Error('db down');
		const { run } = setup({
			complete: vi.fn(async () => {
				throw boom;
			})
		});
		await expect(run('state=s&code=abc')).rejects.toBe(boom);
	});

	it('keeps redirects on our origin and replaces a previous result', () => {
		expect(withOAuthResult('https://evil.example/x', 'denied')).toBe('/?oauth=denied');
		expect(withOAuthResult(`${RETURN_TO}&oauth=connected`, 'expired')).toBe(
			`${RETURN_TO}&oauth=expired`
		);
	});
});
