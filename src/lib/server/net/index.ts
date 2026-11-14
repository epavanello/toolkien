import { notImplemented } from '#lib/server/not-implemented.ts';
import type { AssertSafeUrl, SafeFetch } from './types.ts';

export { UnsafeUrlError } from './types.ts';
export type { AssertSafeUrl, SafeFetch, SafeFetchOptions, UnsafeUrlReason } from './types.ts';

export const assertSafeUrl: AssertSafeUrl = async () => notImplemented('net.assertSafeUrl');
export const safeFetch: SafeFetch = async () => notImplemented('net.safeFetch');
