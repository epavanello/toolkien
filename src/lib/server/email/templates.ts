/**
 * Minimal English templates (text + HTML). Values are escaped; links are ours (`ORIGIN`). No
 * images, tracking pixels or remote assets.
 */
import type { EmailMessage } from './types.ts';

const escape = (value: string) =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');

function layout(product: string, body: string) {
	return `<!doctype html><html><body style="margin:0;padding:24px;background:#fafafa;font-family:ui-sans-serif,system-ui,sans-serif;color:#171717"><div style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;padding:24px"><p style="margin:0 0 16px;font-weight:600">${escape(product)}</p>${body}</div></body></html>`;
}

const button = (url: string, label: string) =>
	`<p style="margin:24px 0"><a href="${escape(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:6px;font-weight:500">${escape(label)}</a></p>`;

export function loginEmail(input: {
	to: string;
	product: string;
	url: string;
	code: string;
	expiresMinutes: number;
}): EmailMessage {
	const { product, url, code, expiresMinutes } = input;
	return {
		kind: 'login',
		to: input.to,
		subject: `Your ${product} sign-in code: ${code}`,
		text: [
			`Sign in to ${product}`,
			'',
			`Enter this code on the sign-in page: ${code}`,
			'',
			`Or open this link and press "Sign in":`,
			url,
			'',
			`The code and the link expire in ${expiresMinutes} minutes and work once.`,
			'If you did not try to sign in, ignore this email: nobody can sign in without it.'
		].join('\n'),
		html: layout(
			product,
			`<p style="margin:0 0 8px">Enter this code on the sign-in page:</p>
<p style="margin:0 0 16px;font-family:ui-monospace,monospace;font-size:28px;letter-spacing:6px;font-weight:600">${escape(code)}</p>
<p style="margin:0">Or open this link and press “Sign in”:</p>${button(url, 'Open sign-in page')}
<p style="margin:0;color:#737373;font-size:13px">The code and the link expire in ${expiresMinutes} minutes and work once. If you did not try to sign in, ignore this email.</p>`
		)
	};
}

export function inviteEmail(input: {
	to: string;
	product: string;
	workspaceName: string;
	inviterName: string;
	role: string;
	url: string;
	expiresAt: Date;
}): EmailMessage {
	const { product, workspaceName, inviterName, role, url } = input;
	const expires = input.expiresAt.toISOString().slice(0, 10);
	return {
		kind: 'invite',
		to: input.to,
		subject: `${inviterName} invited you to ${workspaceName} on ${product}`,
		text: [
			`${inviterName} invited you to the ${workspaceName} workspace on ${product} as ${role}.`,
			'',
			'Accept the invitation:',
			url,
			'',
			`The invitation expires on ${expires}. If you were not expecting it, ignore this email.`
		].join('\n'),
		html: layout(
			product,
			`<p style="margin:0">${escape(inviterName)} invited you to the <strong>${escape(workspaceName)}</strong> workspace as ${escape(role)}.</p>${button(url, 'Accept the invitation')}
<p style="margin:0;color:#737373;font-size:13px">The invitation expires on ${escape(expires)}. If you were not expecting it, ignore this email.</p>`
		)
	};
}
