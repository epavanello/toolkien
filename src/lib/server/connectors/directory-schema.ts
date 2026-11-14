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
const ICON = /^icons\/[a-z0-9]+(?:-[a-z0-9]+)*\.png$/;

/** Directory icons: square PNG, small (`node scripts/directory-icon.ts` makes them) */
export const ICON_MAX_BYTES = 32 * 1024;
const ICON_MIN_SIZE = 32;
const ICON_MAX_SIZE = 512;

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

/**
 * Who runs the server: `official` = the service's own vendor, on its own domain and documented
 * by it; `community` = a third party serving a service it does not own.
 */
export const DIRECTORY_PUBLISHERS = ['official', 'community'] as const;

/**
 * How far the entry was checked: `tested` = someone connected and inspected `tools/list`;
 * `documented` = the endpoint matches the vendor's current docs (and answers as expected);
 * `needs-review` = something is uncertain, explained in `notes`.
 */
export const VERIFICATION_STATUSES = ['tested', 'documented', 'needs-review'] as const;

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
		/**
		 * The service's logo, a file committed next to the entry: `icons/<id>.png` (square PNG,
		 * ≤ 32 KB). Never a remote URL: the app does not hotlink third-party images.
		 */
		icon: z
			.string()
			.regex(ICON, { error: 'Use "icons/<id>.png" (a file in directory/icons/).' })
			.optional(),
		/** Remote MCP endpoint (Streamable HTTP), https only */
		url: httpsUrl,
		/** Suggested namespace in the generated TypeScript (`linear.listIssues`) */
		namespace: z
			.string()
			.regex(NAMESPACE, { error: 'Use camelCase starting with a lowercase letter.' })
			.max(40),
		publisher: z.enum(DIRECTORY_PUBLISHERS),
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
				status: z.enum(VERIFICATION_STATUSES),
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
		if (entry.verification.status === 'needs-review' && !entry.verification.notes) {
			ctx.addIssue({
				code: 'custom',
				path: ['verification', 'notes'],
				message: 'Explain in notes what needs review.'
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
export type DirectoryPublisher = (typeof DIRECTORY_PUBLISHERS)[number];
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/**
 * Trusted like Toolkien's own curation: an official server whose endpoint was checked. Other
 * entries (community, needs review) are handled like free URLs: descriptions flagged as
 * untrusted, permissions proposed for confirmation.
 */
export const isTrustedEntry = (entry: {
	publisher: DirectoryPublisher;
	verification: { status: VerificationStatus };
}) => entry.publisher === 'official' && entry.verification.status !== 'needs-review';

/** Comparable form of an MCP endpoint: lowercase, no hash, no trailing slash */
export function normalizeServerUrl(value: string): string | null {
	try {
		const url = new URL(value.trim());
		return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`.toLowerCase();
	} catch {
		return null;
	}
}

export type DirectoryIssue = { file: string; message: string };

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Why an icon file is not acceptable (`null` = valid): PNG, square, 32 to 512 px, ≤ 32 KB */
export function iconProblem(bytes: Uint8Array): string | null {
	if (bytes.byteLength > ICON_MAX_BYTES) return `Larger than ${ICON_MAX_BYTES / 1024} KB.`;
	if (bytes.byteLength < 24 || PNG_SIGNATURE.some((value, i) => bytes[i] !== value)) {
		return 'Not a PNG file.';
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const [width, height] = [view.getUint32(16), view.getUint32(20)];
	if (width !== height) return `Not square (${width}×${height}).`;
	if (width < ICON_MIN_SIZE || width > ICON_MAX_SIZE) {
		return `Use ${ICON_MIN_SIZE} to ${ICON_MAX_SIZE} px (got ${width}).`;
	}
	return null;
}

/**
 * Validates every file of the directory: schema, `id` = file name, unique ids, namespaces and
 * URLs. With `icons` (file name → bytes of `directory/icons/*`), also that every referenced icon
 * exists and is valid, and that no icon is left unreferenced. Returns the parsed entries and the
 * issues (empty = valid).
 */
export function validateDirectory(
	files: { name: string; content: string }[],
	icons?: Map<string, Uint8Array>
): {
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
			['url', normalizeServerUrl(entry.url) ?? entry.url]
		] as const) {
			const other = seen[key].get(value);
			if (other)
				issues.push({
					file: file.name,
					message: `Duplicate ${key} "${value}" (also in ${other}).`
				});
			else seen[key].set(value, file.name);
		}
		if (entry.icon && icons) {
			const bytes = icons.get(entry.icon.slice('icons/'.length));
			const problem = bytes ? iconProblem(bytes) : 'File not found in directory/icons/.';
			if (problem) issues.push({ file: file.name, message: `icon: ${problem}` });
		}
		entries.push(entry);
	}
	if (icons) {
		const used = new Set(entries.map((entry) => entry.icon?.slice('icons/'.length)));
		for (const name of icons.keys()) {
			if (!used.has(name))
				issues.push({ file: `icons/${name}`, message: 'Not used by any entry.' });
		}
	}
	return { entries, issues };
}

/** JSON Schema of an entry (for editors: `"$schema": "../schema.json"`) */
export const directoryJsonSchema = () =>
	z.toJSONSchema(directoryEntrySchema, { io: 'input', unrepresentable: 'any' });
