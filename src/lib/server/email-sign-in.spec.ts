/**
 * Passwordless sign-in, in process: real Better Auth (magic link + email OTP plugins) on a
 * migrated test database, the email transport replaced by an in-memory outbox (never Resend).
 */
import { isHttpError } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const outbox: { to: string; subject: string; text: string; html: string; kind: string }[] = [];
let configured = true;

// No SvelteKit request here: the cookie plugin has nowhere to write (results are checked instead)
vi.mock('$app/server', () => ({ getRequestEvent: () => null }));

vi.mock('#lib/server/db/index.ts', async () => {
	const { createTestDb } = await import('#lib/server/workspaces/test-db.ts');
	return { db: await createTestDb() };
});

vi.mock('#lib/server/email/index.ts', async () => {
	const templates = await import('#lib/server/email/templates.ts');
	const { EmailError } = await import('#lib/server/email/types.ts');
	return {
		...templates,
		EmailError,
		emailConfigured: () => configured,
		sendEmail: async (message: (typeof outbox)[number]) => {
			outbox.push(message);
		}
	};
});

const { auth } = await import('#lib/server/auth.ts');
const { db } = await import('#lib/server/db/index.ts');
const schema = await import('#lib/server/db/schema/index.ts');
const { resetRateLimits } = await import('#lib/server/limits/index.ts');
const { confirmMagicLink, EMAIL_SIGN_IN_LIMITS, requestEmailSignIn, verifyEmailCode } =
	await import('./email-sign-in.ts');

const ORIGIN = new URL(auth.options.baseURL as string).origin;
const headers = () => new Headers({ origin: ORIGIN, 'user-agent': 'vitest' });

async function request(email: string, redirectTo?: string, ip = '203.0.113.1') {
	await requestEmailSignIn({ email, redirectTo, ip, headers: headers() });
	const message = outbox.at(-1)!;
	const code = /code on the sign-in page: (\d{6})/.exec(message.text)![1]!;
	const link = new URL(/^(http\S+\/login\/confirm\S*)$/m.exec(message.text)![1]!);
	return { message, code, link, token: link.searchParams.get('token')! };
}

async function status(call: () => Promise<unknown>) {
	try {
		await call();
		return 200;
	} catch (cause) {
		if (isHttpError(cause)) return cause.status;
		throw cause;
	}
}

beforeEach(() => {
	outbox.length = 0;
	configured = true;
	resetRateLimits();
});

describe('email sign-in', () => {
	it('sends one email with a 6-digit code and a confirm link, storing neither in clear', async () => {
		const { message, code, link, token } = await request('Ada@Example.com', '/consent?x=1');
		expect(outbox).toHaveLength(1);
		expect(message).toMatchObject({ to: 'ada@example.com', kind: 'login' });
		expect(message.subject).toContain(code);
		expect(link.pathname).toBe('/login/confirm');
		expect(link.searchParams.get('redirectTo')).toBe('/consent?x=1');
		// Never Better Auth's GET verify URL (a link scanner would consume it)
		expect(message.text).not.toContain('/api/auth/magic-link/verify');
		const stored = JSON.stringify(await db.select().from(schema.verification));
		expect(stored).not.toContain(token);
		expect(stored).not.toContain(`${code}:`);
	});

	it('drops unsafe redirect targets', async () => {
		const { link } = await request('eve@example.com', 'https://evil.example/');
		expect(link.searchParams.get('redirectTo')).toBeNull();
	});

	it('signs up with the code and creates the personal workspace', async () => {
		const { code } = await request('grace@example.com');
		expect(
			await status(() =>
				verifyEmailCode({ email: 'grace@example.com', code: '000000', headers: headers() })
			)
		).toBe(400);
		const result = await verifyEmailCode({ email: 'grace@example.com', code, headers: headers() });
		expect(result.user.email).toBe('grace@example.com');
		expect(result.user.name).toBe('grace');
		const workspaces = await db.select().from(schema.organization);
		expect(workspaces.some((w) => w.kind === 'personal')).toBe(true);
		// Single use
		expect(
			await status(() => verifyEmailCode({ email: 'grace@example.com', code, headers: headers() }))
		).toBe(400);
	});

	it('only the confirm button consumes the link, once; the GET verify endpoint is disabled', async () => {
		const { token } = await request('linus@example.com');
		// What a link scanner could reach: Better Auth's verify endpoint is not served
		const scanned = await auth.handler(
			new Request(`${ORIGIN}/api/auth/magic-link/verify?token=${token}`)
		);
		expect(scanned.status).toBe(404);
		const result = await confirmMagicLink({ token, headers: headers() });
		expect((result as { user: { email: string } }).user.email).toBe('linus@example.com');
		expect(await status(() => confirmMagicLink({ token, headers: headers() }))).toBe(400);
	});

	it('serves no password or public email-sending endpoints', async () => {
		for (const path of [
			'/api/auth/sign-up/email',
			'/api/auth/sign-in/email',
			'/api/auth/sign-in/magic-link',
			'/api/auth/email-otp/send-verification-otp',
			'/api/auth/sign-in/email-otp'
		]) {
			const response = await auth.handler(
				new Request(`${ORIGIN}${path}`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
					body: JSON.stringify({ email: 'x@example.com', password: 'p'.repeat(16), name: 'X' })
				})
			);
			expect(response.status, path).toBeGreaterThanOrEqual(400);
		}
		expect(outbox).toHaveLength(0);
	});

	it('rate-limits sends per address and per IP', async () => {
		for (let i = 0; i < EMAIL_SIGN_IN_LIMITS.perEmail; i++)
			await request('rate@example.com', '/', `198.51.100.${i}`);
		expect(
			await status(() =>
				requestEmailSignIn({ email: 'RATE@example.com', ip: '198.51.100.99', headers: headers() })
			)
		).toBe(429);
		resetRateLimits();
		for (let i = 0; i < EMAIL_SIGN_IN_LIMITS.perIp; i++) {
			await requestEmailSignIn({
				email: `ip${i}@example.com`,
				ip: '192.0.2.7',
				headers: headers()
			});
		}
		expect(
			await status(() =>
				requestEmailSignIn({ email: 'other@example.com', ip: '192.0.2.7', headers: headers() })
			)
		).toBe(429);
	});

	it('refuses email sign-in without a transport', async () => {
		configured = false;
		expect(
			await status(() =>
				requestEmailSignIn({ email: 'a@example.com', ip: null, headers: headers() })
			)
		).toBe(503);
		expect(outbox).toHaveLength(0);
	});
});
