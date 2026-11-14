/** Transactional email (see `types.ts`) */
import { dev } from '$app/env';
import { EMAIL_FROM, RESEND_API_KEY, RESEND_BASE_URL } from '$app/env/private';
import { safeFetch } from '#lib/server/net/index.ts';
import { createConsoleTransport } from './console.ts';
import { createResendTransport } from './resend.ts';
import { EmailError, type EmailMessage, type EmailTransport } from './types.ts';

export type * from './types.ts';
export { EmailError } from './types.ts';
export { inviteEmail, loginEmail } from './templates.ts';

/** Resend when configured; the console in development; nothing in production otherwise */
export function selectTransport(env: {
	dev: boolean;
	apiKey?: string;
	from?: string;
	baseUrl?: string;
	fetch: (url: string, init: RequestInit) => Promise<Response>;
}): EmailTransport | null {
	if (env.apiKey && env.from) {
		return createResendTransport({
			apiKey: env.apiKey,
			from: env.from,
			baseUrl: env.baseUrl,
			fetch: env.fetch
		});
	}
	return env.dev ? createConsoleTransport() : null;
}

const transport = selectTransport({
	dev,
	apiKey: RESEND_API_KEY,
	from: EMAIL_FROM,
	baseUrl: RESEND_BASE_URL,
	fetch: (url, init) => safeFetch(url, init)
});

if (!transport && !dev) {
	console.warn('[email] RESEND_API_KEY / EMAIL_FROM are not set: email sign-in is disabled');
} else if (transport) {
	console.info(`[email] transport: ${transport.name}`);
}

/** Whether email can be sent (sign-in by email needs it) */
export const emailConfigured = () => transport !== null;
export const emailTransportName = () => transport?.name ?? null;

export async function sendEmail(message: EmailMessage): Promise<void> {
	if (!transport) throw new EmailError('Email is not configured on this server.');
	await transport.send(message);
}
