import type { EmailMessage, EmailTransport } from './types.ts';

/** Development only: prints the message (links and codes) to the server console */
export function createConsoleTransport(log: (line: string) => void = console.info): EmailTransport {
	return {
		name: 'console',
		async send(message: EmailMessage) {
			log(
				[
					`[email:dev] ${message.kind} → ${message.to}`,
					`Subject: ${message.subject}`,
					message.text,
					'[email:dev] end'
				].join('\n')
			);
		}
	};
}
