import { building, dev } from '$app/env';
import {
	sequence,
	type Handle,
	type HandleServerError,
	type ServerInit
} from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { isErrorCode } from '#lib/core/errors.ts';
import { auth } from '#lib/server/auth.ts';
import { startJobs } from '#lib/server/jobs/index.ts';
import { isMachinePath, robotsTag } from '#lib/server/robots.ts';
import { isBearerOnlyPath, isCrossSiteFormRequest, securityHeaders } from '#lib/server/security.ts';

export const init: ServerInit = () => {
	// Modules register their jobs at import time; nothing runs during the build
	if (!building) startJobs();
};

const headers = securityHeaders({ production: !dev });

const handleSecurity: Handle = async ({ event, resolve }) => {
	if (isCrossSiteFormRequest(event.request, event.url)) {
		return new Response('Cross-site form submissions are not allowed', { status: 403 });
	}
	const response = await resolve(event);
	for (const [name, value] of Object.entries(headers)) {
		if (!response.headers.has(name)) response.headers.set(name, value);
	}
	// App surfaces and error responses stay out of search results (also for non-HTML bodies)
	const robots = robotsTag(event.url.pathname, response.status);
	if (robots && !response.headers.has('X-Robots-Tag')) response.headers.set('X-Robots-Tag', robots);
	return response;
};

const handleAuth: Handle = async ({ event, resolve }) => {
	event.locals.user = null;
	event.locals.session = null;
	if (isBearerOnlyPath(event.url.pathname)) return resolve(event);

	const session = await auth.api.getSession({ headers: event.request.headers });
	// A suspended user (user-level kill switch) is treated as signed out everywhere
	if (session && !session.user.suspendedAt) {
		event.locals.user = session.user;
		event.locals.session = session.session;
	}
	return svelteKitHandler({ event, resolve, auth, building });
};

/**
 * MCP, `/api/**` and `/.well-known/**` are called by programs: an unknown path there gets a JSON
 * 404, not the HTML error page. (`/api/auth/**` is answered by Better Auth in `handleAuth`.)
 */
const handleMachineNotFound: Handle = ({ event, resolve }) => {
	if (event.route.id === null && isMachinePath(event.url.pathname)) {
		return Response.json({ code: 'NOT_FOUND', message: 'Not found.' }, { status: 404 });
	}
	return resolve(event);
};

export const handle: Handle = sequence(handleSecurity, handleAuth, handleMachineNotFound);

/**
 * Remote functions reject invalid input before running and SvelteKit answers a plain "Bad
 * Request". Our own checks (`refine` / custom issues) carry user-facing messages: forward the
 * first one. `error(...)` bodies already carry their code and message. Unknown errors are logged
 * with a short reference id (shown on the error page, so a report can be matched to the log) and
 * never leak details to the client outside development. Only the path is logged, never the
 * query string (it can carry OAuth codes or tokens).
 */
export const handleError: HandleServerError = ({ kind, error, issues, event }) => {
	if (kind === 'validation') {
		const custom = issues?.find((issue) => 'code' in issue && issue.code === 'custom');
		return { code: 'INVALID_INPUT', message: custom?.message ?? 'Invalid input.' };
	}
	if (kind === 'app') return { ...error, code: isErrorCode(error.code) ? error.code : 'GENERIC' };
	if (kind === 'framework') {
		return {
			code: error.status === 404 ? 'NOT_FOUND' : 'GENERIC',
			message: error.message
		};
	}
	const id = crypto.randomUUID().slice(0, 8);
	console.error(`[error ${id}] ${event.request.method} ${event.url.pathname}`, error);
	const detail = dev && error instanceof Error ? error.message : null;
	return { code: 'GENERIC', message: detail ?? 'Internal error', id };
};
