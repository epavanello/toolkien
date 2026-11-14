import { describe, expect, it, vi } from 'vitest';
import { createConsoleTransport } from './console.ts';
import { createResendTransport } from './resend.ts';
import { inviteEmail, loginEmail } from './templates.ts';
import { EmailError } from './types.ts';

vi.mock('$app/env', () => ({ dev: false }));
vi.mock('$app/env/private', () => ({
	RESEND_API_KEY: undefined,
	EMAIL_FROM: undefined,
	RESEND_BASE_URL: 'https://api.resend.com'
}));
vi.mock('#lib/server/net/index.ts', () => ({ safeFetch: vi.fn() }));

const { selectTransport } = await import('./index.ts');

const message = loginEmail({
	to: 'ada@example.com',
	product: 'Toolkien',
	url: 'https://toolkien.test/login/confirm?token=abc',
	code: '123456',
	expiresMinutes: 10
});

describe('email transport', () => {
	it('posts to the Resend API with the key, sender and both bodies', async () => {
		const fetch = vi.fn(async () => new Response('{"id":"x"}', { status: 200 }));
		const transport = createResendTransport({
			apiKey: 're_test',
			from: 'Toolkien <login@toolkien.test>',
			baseUrl: 'https://api.resend.test/',
			fetch
		});
		await transport.send(message);
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.resend.test/emails');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test');
		const body = JSON.parse(String(init.body));
		expect(body).toMatchObject({
			from: 'Toolkien <login@toolkien.test>',
			to: ['ada@example.com'],
			subject: message.subject,
			tags: [{ name: 'kind', value: 'login' }]
		});
		expect(body.text).toContain('123456');
		expect(body.html).toContain('123456');
	});

	it('reports failures by status, never echoing the response', async () => {
		const transport = createResendTransport({
			apiKey: 're_test',
			from: 'a@b.test',
			fetch: async () =>
				new Response('{"message":"to: ada@example.com is invalid"}', { status: 422 })
		});
		const error = await transport.send(message).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(EmailError);
		expect((error as EmailError).status).toBe(422);
		expect((error as EmailError).message).not.toContain('ada@example.com');
	});

	it('uses Resend when configured, the console only in development, nothing otherwise', () => {
		const fetch = vi.fn();
		expect(selectTransport({ dev: false, apiKey: 'k', from: 'a@b.test', fetch })?.name).toBe(
			'resend'
		);
		expect(selectTransport({ dev: true, apiKey: 'k', from: 'a@b.test', fetch })?.name).toBe(
			'resend'
		);
		expect(selectTransport({ dev: true, fetch })?.name).toBe('console');
		expect(selectTransport({ dev: false, fetch })).toBeNull();
		expect(selectTransport({ dev: false, apiKey: 'k', fetch })).toBeNull();
	});

	it('prints link and code in development', async () => {
		const lines: string[] = [];
		await createConsoleTransport((line) => lines.push(line)).send(message);
		expect(lines.join('\n')).toContain('123456');
		expect(lines.join('\n')).toContain('/login/confirm?token=abc');
	});

	it('escapes values in the HTML templates', () => {
		const invite = inviteEmail({
			to: 'x@example.com',
			product: 'Toolkien',
			workspaceName: '<script>alert(1)</script>',
			inviterName: 'Eve "admin"',
			role: 'member',
			url: 'https://toolkien.test/invite/t',
			expiresAt: new Date('2026-12-01T00:00:00Z')
		});
		expect(invite.html).not.toContain('<script>');
		expect(invite.html).toContain('&lt;script&gt;');
		expect(invite.text).toContain('expires on 2026-12-01');
	});
});
