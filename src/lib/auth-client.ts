import { passkeyClient } from '@better-auth/passkey/client';
import { organizationClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/svelte';

/**
 * Browser-side Better Auth client, only for flows that need the browser itself (WebAuthn
 * passkeys, the Google sign-in redirect). Everything else goes through remote functions in `#lib/functions/auth.remote.ts`.
 */
export const authClient = createAuthClient({
	plugins: [passkeyClient(), organizationClient()]
});
