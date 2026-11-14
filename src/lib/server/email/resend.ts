import { EmailError, type EmailMessage, type EmailTransport } from './types.ts';

export type ResendOptions = {
	apiKey: string;
	from: string;
	/** `https://api.resend.com` by default */
	baseUrl?: string;
	/** Injected for tests; production passes the SSRF-safe `net.safeFetch` */
	fetch: (url: string, init: RequestInit) => Promise<Response>;
	timeoutMs?: number;
};

/** Resend over its HTTP API (no SDK): `POST /emails` */
export function createResendTransport(options: ResendOptions): EmailTransport {
	const endpoint = `${(options.baseUrl ?? 'https://api.resend.com').replace(/\/+$/, '')}/emails`;
	return {
		name: 'resend',
		async send(message: EmailMessage) {
			let response: Response;
			try {
				response = await options.fetch(endpoint, {
					method: 'POST',
					headers: {
						Authorization: `Bearer ${options.apiKey}`,
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						from: options.from,
						to: [message.to],
						subject: message.subject,
						text: message.text,
						html: message.html,
						tags: [{ name: 'kind', value: message.kind }]
					}),
					signal: AbortSignal.timeout(options.timeoutMs ?? 10_000)
				});
			} catch {
				throw new EmailError('The email service is unreachable.');
			}
			// Never echo the response body: it can contain the recipient or request details
			if (!response.ok)
				throw new EmailError('The email service refused the message.', response.status);
		}
	};
}
