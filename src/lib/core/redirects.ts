/**
 * Keeps a user-supplied redirect target on our origin: only absolute paths are accepted
 * (`/w/acme`), never protocol-relative (`//evil.example`), backslash tricks or full URLs.
 */
export function safeRedirectPath(target: string | null | undefined, fallback = '/'): string {
	if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
		return fallback;
	}
	try {
		const url = new URL(target, 'http://localhost');
		return url.origin === 'http://localhost' ? `${url.pathname}${url.search}${url.hash}` : fallback;
	} catch {
		return fallback;
	}
}
