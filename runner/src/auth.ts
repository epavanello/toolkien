/** Shared-secret check for the app → supervisor connection. */

const encoder = new TextEncoder();

/**
 * Constant-time comparison: both values are hashed first so the comparison always runs over
 * 32 bytes, whatever the length of the attacker's input.
 */
export async function safeEqual(a: string, b: string): Promise<boolean> {
	const [ha, hb] = await Promise.all([
		crypto.subtle.digest('SHA-256', encoder.encode(a)),
		crypto.subtle.digest('SHA-256', encoder.encode(b))
	]);
	const x = new Uint8Array(ha);
	const y = new Uint8Array(hb);
	let diff = 0;
	for (let i = 0; i < x.length; i++) diff |= x[i]! ^ y[i]!;
	return diff === 0;
}

export async function isAuthorized(request: Request, secret: string): Promise<boolean> {
	const header = request.headers.get('authorization') ?? '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : '';
	// Always compare, even with an empty token, so timing does not reveal the header shape
	const ok = await safeEqual(token, secret);
	return ok && token.length > 0;
}
