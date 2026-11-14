import { defineEnvVars } from '@sveltejs/kit/env';

/** Optional string: unset and empty both become `undefined` */
const optional = (value: string | undefined) => (value?.trim() ? value.trim() : undefined);

/** Positive integer with a default, so limits can be tuned per deploy without code changes */
const positiveInt = (fallback: number) => (value: string | undefined) => {
	if (!value?.trim()) return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer`);
	return parsed;
};

/**
 * Every environment variable the app reads. Values come from Coolify in production and from
 * `.env` locally; nothing secret lives in the repo. Import them from `$app/env/private`.
 *
 * Variables are optional at the schema level when the app can boot without them (build, tests,
 * local dev): the module that needs one fails loudly when it is missing at use time.
 */
export const variables = defineEnvVars({
	// ─── Database ────────────────────────────────────────────────────────────
	DATABASE_URL: {
		description:
			'libSQL URL. Local: `file:local.db`. Production: the Turso database URL (`libsql://…`, EU region).',
		schema: (value) => value?.trim() || 'file:local.db'
	},
	DATABASE_AUTH_TOKEN: {
		description: 'Turso auth token. Required unless `DATABASE_URL` is a `file:` URL.',
		schema: optional
	},

	// ─── App and auth ────────────────────────────────────────────────────────
	ORIGIN: {
		description:
			'Public origin of the app, without trailing slash (e.g. `https://toolkien.example`). Also the OAuth issuer and the base of the MCP resource `${ORIGIN}/mcp`.',
		schema: (value) => (value?.trim() || 'http://localhost:5173').replace(/\/+$/, '')
	},
	BETTER_AUTH_SECRET: {
		description:
			'Secret that signs sessions and tokens: at least 32 random characters (`openssl rand -base64 32`).',
		schema: optional
	},
	// ─── Email (passwordless sign-in, invitations) ───────────────────────────
	RESEND_API_KEY: {
		description:
			'Resend API key (transactional email: sign-in links and codes, workspace invitations). Required in production; in development without it the link and code are printed to the server console.',
		schema: optional
	},
	EMAIL_FROM: {
		description:
			'Sender address on a domain verified in Resend, e.g. `Toolkien <login@toolkien.example>`.',
		schema: optional
	},
	RESEND_BASE_URL: {
		description:
			'Resend API base URL (default `https://api.resend.com`). The sending region (e.g. EU) is chosen per domain in Resend.',
		schema: (value) => (value?.trim() || 'https://api.resend.com').replace(/\/+$/, '')
	},
	PLATFORM_ADMIN_EMAILS: {
		description:
			'Comma-separated emails of platform admins (access to `/admin`: limits, kill switches).',
		schema: (value) =>
			(value ?? '')
				.split(',')
				.map((email) => email.trim().toLowerCase())
				.filter(Boolean)
	},

	// ─── Secrets (OpenBao transit) ──────────────────────────────────────────
	OPENBAO_ADDR: {
		description:
			'OpenBao address on the internal `core` network (e.g. `http://openbao:8200`). When unset, dev uses `TOOLKIEN_DEV_MASTER_KEY`.',
		schema: optional
	},
	OPENBAO_ROLE_ID: { description: 'AppRole `role_id` of the `app` policy.', schema: optional },
	OPENBAO_SECRET_ID: { description: 'AppRole `secret_id` of the `app` policy.', schema: optional },
	OPENBAO_TRANSIT_KEY: {
		description:
			'Name of the derived transit key that wraps workspace data keys (workspace id is the derivation context).',
		schema: (value) => value?.trim() || 'toolkien-tokens'
	},
	TOOLKIEN_DEV_MASTER_KEY: {
		description:
			'Development only: base64 32-byte key used instead of OpenBao to wrap data keys. Refused in production.',
		schema: optional
	},

	// ─── Runner and egress ──────────────────────────────────────────────────
	RUNNER_URL: {
		description:
			'Runner supervisor URL on the internal `sandbox` network (`ws://runner:8787` in compose). Empty in development: the app starts a local supervisor with the `deno` binary.',
		schema: optional
	},
	RUNNER_SHARED_SECRET: {
		description: 'Shared secret the app and the runner supervisor use to authenticate each other.',
		schema: optional
	},
	EGRESS_PROXY_URL: {
		description:
			'HTTP proxy every upstream call goes through (e.g. `http://egress:3128`). Unset in dev: direct, still SSRF-checked.',
		schema: optional
	},

	// ─── Limits ─────────────────────────────────────────────────────────────
	EXEC_TIMEOUT_MS: {
		description: 'Wall-clock limit of one script execution, in ms.',
		schema: positiveInt(120_000)
	},
	EXEC_MAX_TOOL_CALLS: {
		description: 'Maximum tool calls a single execution can make.',
		schema: positiveInt(200)
	},
	EXEC_MAX_OUTPUT_BYTES: {
		description: 'Result + console output returned to the agent before truncation, in bytes.',
		schema: positiveInt(102_400)
	},
	RATE_LIMIT_EXEC_PER_MIN: {
		description: 'Executions per user per minute (in memory, reset on restart).',
		schema: positiveInt(60)
	},
	AUDIT_RETENTION_DAYS: {
		description: 'Days audit events are kept before the daily job deletes them.',
		schema: positiveInt(90)
	}
});
