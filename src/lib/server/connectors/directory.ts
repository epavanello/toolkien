import {
	directoryEntrySchema,
	isSupportedEntry,
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

/**
 * Icons (`directory/icons/*.png`) as asset URLs: Vite fingerprints them (or inlines the small
 * ones as data URIs), so they are served by Toolkien itself and cached forever. Never hotlinked.
 */
const icons = import.meta.glob<string>('/directory/icons/*.png', {
	eager: true,
	query: '?url',
	import: 'default'
});
const iconUrl = (icon: string | undefined) => (icon ? icons[`/directory/${icon}`] : undefined);

export function toDirectoryEntry(
	file: DirectoryEntryFile,
	icon: string | undefined = iconUrl(file.icon)
): DirectoryEntry {
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
		icon,
		namespace: file.namespace,
		scopes: file.auth.scopes,
		annotations,
		category: file.category,
		tags: file.tags,
		tagline: file.tagline,
		examples: file.examples,
		popular: file.popular ?? false,
		supported: isSupportedEntry(file),
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

/** What the landing page shows: popular servers (logo, name, tagline) and the directory size */
export function directoryShowcase(limit = 12) {
	const popular = entries.filter((entry) => entry.popular && entry.supported).slice(0, limit);
	return {
		servers: popular.map(({ id, name, icon, tagline }) => ({ id, name, icon, tagline })),
		total: entries.length
	};
}
