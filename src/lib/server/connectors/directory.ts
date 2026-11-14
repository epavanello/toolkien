import {
	directoryEntrySchema,
	isTrustedEntry,
	normalizeServerUrl,
	type DirectoryEntryFile
} from './directory-schema.ts';
import type { DirectoryEntry, ToolAnnotations } from './types.ts';

/**
 * The curated directory: `directory/servers/*.json`, contributed through pull requests and
 * validated in CI (`pnpm directory:validate` + `directory.spec.ts`). Bundled at build time by
 * Vite's `import.meta.glob`, parsed once at startup; an invalid file fails loudly.
 */
const files = import.meta.glob<unknown>('/directory/servers/*.json', {
	eager: true,
	import: 'default'
});

export function toDirectoryEntry(file: DirectoryEntryFile): DirectoryEntry {
	const annotations: Record<string, ToolAnnotations> = {};
	const toolNotes: Record<string, string> = {};
	for (const [name, tool] of Object.entries(file.tools)) {
		if (tool.annotations) annotations[name] = tool.annotations;
		if (tool.note) toolNotes[name] = tool.note;
	}
	return {
		id: file.id,
		name: file.name,
		description: file.description,
		url: file.url,
		authType: file.auth.type,
		homepage: file.homepage,
		namespace: file.namespace,
		scopes: file.auth.scopes,
		annotations,
		category: file.category,
		tags: file.tags,
		toolNotes,
		tokenHelp: file.auth.tokenHelp,
		tokenUrl: file.auth.tokenUrl,
		oauthRegistration: file.auth.oauth?.registration,
		publisher: file.publisher,
		trusted: isTrustedEntry(file),
		verification: file.verification
	};
}

function load(): DirectoryEntry[] {
	return Object.entries(files)
		.map(([path, raw]) => {
			const parsed = directoryEntrySchema.safeParse(raw);
			if (!parsed.success)
				throw new Error(`Invalid directory entry ${path}: run pnpm directory:validate`);
			return toDirectoryEntry(parsed.data);
		})
		.sort((a, b) => a.name.localeCompare(b.name));
}

const entries = load();
const byId = new Map(entries.map((entry) => [entry.id, entry]));
const byUrl = new Map(entries.map((entry) => [normalizeServerUrl(entry.url), entry]));

export const listDirectoryEntries = (): DirectoryEntry[] => entries;
export const getDirectoryEntry = (id: string | null | undefined): DirectoryEntry | null =>
	(id && byId.get(id)) || null;

/** The entry whose endpoint is this URL (trailing slash and case ignored), if any */
export const findDirectoryEntryByUrl = (url: string): DirectoryEntry | null =>
	byUrl.get(normalizeServerUrl(url)) ?? null;
