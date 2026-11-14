import { z } from 'zod';

/**
 * Schema of one curated directory entry: `directory/servers/<id>.json`, contributed through
 * pull requests. Pure (zod only, no app imports) so `pnpm directory:validate` can run it with
 * plain Node. `directory/schema.json` is generated from it (`pnpm directory:validate --write`)
 * and a test checks it stays in sync.
 */

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const NAMESPACE = /^[a-z][A-Za-z0-9]*$/;
const SCOPE = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

const httpsUrl = z
	.url({ error: 'Must be an absolute URL.' })
	.refine((value) => new URL(value).protocol === 'https:', { error: 'Must use https.' })
	.refine((value) => !new URL(value).username && !new URL(value).password, {
		error: 'Must not contain credentials.'
	});

const isoDate = z.iso.date({ error: 'Use YYYY-MM-DD.' });

export const DIRECTORY_CATEGORIES = [
	'developer-tools',
	'project-management',
	'knowledge',
	'data',
	'payments',
	'search',
	'monitoring',
	'design',
	'communication',
	'other'
] as const;

export const toolAnnotationsSchema = z
	.object({
		title: z.string().max(100).optional(),
		readOnlyHint: z.boolean().optional(),
		destructiveHint: z.boolean().optional(),
		idempotentHint: z.boolean().optional(),
		openWorldHint: z.boolean().optional()
	})
	.strict();

export const directoryToolSchema = z
	.object({
		/** Verified annotations; they override what the server reports for this tool */
		annotations: toolAnnotationsSchema.optional(),
		/** Reviewer note shown in the UI (why the annotation, caveats) */
		note: z.string().max(500).optional()
	})
	.strict();

export const directoryEntrySchema = z
	.object({
		$schema: z.string().optional(),
		/** Stable slug, equal to the file name; stored in `connector.directory_id`, never renamed */
		id: z.string().regex(ID, { error: 'Use kebab-case (a-z, 0-9, -).' }).max(60),
		name: z.string().min(1).max(60),
		description: z.string().min(10).max(300),
		homepage: httpsUrl.optional(),
		/** Remote MCP endpoint (Streamable HTTP), https only */
		url: httpsUrl,
		/** Suggested namespace in the generated TypeScript (`linear.listIssues`) */
		namespace: z
			.string()
			.regex(NAMESPACE, { error: 'Use camelCase starting with a lowercase letter.' })
			.max(40),
		category: z.enum(DIRECTORY_CATEGORIES),
		tags: z.array(z.string().regex(ID).max(30)).max(10).default([]),
		auth: z
			.object({
				type: z.enum(['oauth', 'token', 'none']),
				/** Minimal scopes to request (OAuth); omit to let the server's challenge decide */
				scopes: z.array(z.string().regex(SCOPE)).max(20).optional(),
				/** OAuth hints for reviewers and the client */
				oauth: z
					.object({
						/** Registration the upstream supports, in order of preference */
						registration: z
							.array(z.enum(['cimd', 'dcr', 'preregistered']))
							.min(1)
							.optional(),
						/** Expected authorization server issuer (checked against discovery) */
						issuer: httpsUrl.optional()
					})
					.strict()
					.optional(),
				/** For `token`: where the user creates the token / key (shown in the UI) */
				tokenHelp: z.string().max(300).optional(),
				tokenUrl: httpsUrl.optional()
			})
			.strict(),
		/** Per-tool overrides and notes, keyed by the upstream tool name */
		tools: z.record(z.string().min(1).max(128), directoryToolSchema).default({}),
		verification: z
			.object({
				status: z.enum(['verified', 'community', 'unverified']),
				/** GitHub handle (without @) of who checked the entry */
				by: z.string().min(1).max(60),
				on: isoDate,
				notes: z.string().max(1000).optional()
			})
			.strict()
	})
	.strict()
	.superRefine((entry, ctx) => {
		if (entry.auth.type !== 'oauth' && (entry.auth.oauth || entry.auth.scopes)) {
			ctx.addIssue({
				code: 'custom',
				path: ['auth'],
				message: 'OAuth hints need auth.type "oauth".'
			});
		}
		if (entry.auth.type !== 'token' && (entry.auth.tokenHelp || entry.auth.tokenUrl)) {
			ctx.addIssue({
				code: 'custom',
				path: ['auth'],
				message: 'Token hints need auth.type "token".'
			});
		}
	});

export type DirectoryEntryFile = z.infer<typeof directoryEntrySchema>;

export type DirectoryIssue = { file: string; message: string };

/**
 * Validates every file of the directory: schema, `id` = file name, unique ids, namespaces and
 * URLs. Returns the parsed entries and the issues (empty = valid).
 */
export function validateDirectory(files: { name: string; content: string }[]): {
	entries: DirectoryEntryFile[];
	issues: DirectoryIssue[];
} {
	const issues: DirectoryIssue[] = [];
	const entries: DirectoryEntryFile[] = [];
	const seen = {
		id: new Map<string, string>(),
		namespace: new Map<string, string>(),
		url: new Map<string, string>()
	};
	for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
		if (!file.name.endsWith('.json')) {
			issues.push({ file: file.name, message: 'Entries are .json files.' });
			continue;
		}
		let raw: unknown;
		try {
			raw = JSON.parse(file.content);
		} catch {
			issues.push({ file: file.name, message: 'Invalid JSON.' });
			continue;
		}
		const parsed = directoryEntrySchema.safeParse(raw);
		if (!parsed.success) {
			for (const issue of parsed.error.issues) {
				issues.push({
					file: file.name,
					message: `${issue.path.join('.') || '(root)'}: ${issue.message}`
				});
			}
			continue;
		}
		const entry = parsed.data;
		if (`${entry.id}.json` !== file.name) {
			issues.push({ file: file.name, message: `id "${entry.id}" must match the file name.` });
		}
		for (const [key, value] of [
			['id', entry.id],
			['namespace', entry.namespace],
			['url', entry.url.replace(/\/+$/, '')]
		] as const) {
			const other = seen[key].get(value);
			if (other)
				issues.push({
					file: file.name,
					message: `Duplicate ${key} "${value}" (also in ${other}).`
				});
			else seen[key].set(value, file.name);
		}
		entries.push(entry);
	}
	return { entries, issues };
}

/** JSON Schema of an entry (for editors: `"$schema": "../schema.json"`) */
export const directoryJsonSchema = () =>
	z.toJSONSchema(directoryEntrySchema, { io: 'input', unrepresentable: 'any' });
