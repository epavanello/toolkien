import { PLATFORM_ADMIN_EMAILS } from '$app/env/private';

/** Platform admins are configured by email (`PLATFORM_ADMIN_EMAILS`), case-insensitive */
export const isPlatformAdminEmail = (email: string | null | undefined) =>
	!!email && PLATFORM_ADMIN_EMAILS.includes(email.trim().toLowerCase());
