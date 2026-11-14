/**
 * Transactional email contract (sign-in links and codes, workspace invitations).
 *
 * - Production sends through Resend (`RESEND_API_KEY`, `EMAIL_FROM`); without a transport, email
 *   sign-in is refused (`emailConfigured()` is false) instead of silently failing.
 * - Development without a key uses the console transport: the message is printed to the server
 *   console so links and codes can be used locally. It is never used in production.
 * - Messages carry secrets (links, codes): transports never log bodies in production; errors
 *   name the status only.
 */
export type EmailMessage = {
	to: string;
	subject: string;
	text: string;
	html: string;
	/** Short label for logs and Resend tags (`login`, `invite`); never content */
	kind: 'login' | 'invite';
};

export interface EmailTransport {
	readonly name: 'resend' | 'console';
	send(message: EmailMessage): Promise<void>;
}

export class EmailError extends Error {
	constructor(
		message: string,
		readonly status?: number
	) {
		super(message);
		this.name = 'EmailError';
	}
}
