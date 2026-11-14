import type { DirectoryEntry } from '#lib/server/connectors/types.ts';

/**
 * Presentation helpers of the server directory (in-app and public pages): category labels,
 * the friendly auth hint and the search/filter logic. Pure, so it is shared by both pages and
 * unit-tested.
 */

/** Fields the directory UI needs from an entry */
export type DirectoryItem = Pick<
	DirectoryEntry,
	| 'id'
	| 'name'
	| 'description'
	| 'tagline'
	| 'icon'
	| 'category'
	| 'tags'
	| 'popular'
	| 'publisher'
	| 'authType'
	| 'supported'
	| 'verification'
>;

const CATEGORY_LABELS: Record<string, string> = {
	'developer-tools': 'Developer tools',
	cloud: 'Cloud & infrastructure',
	data: 'Data & analytics',
	monitoring: 'Monitoring',
	security: 'Security',
	'project-management': 'Project management',
	productivity: 'Productivity',
	knowledge: 'Docs & knowledge',
	communication: 'Communication',
	crm: 'CRM & sales',
	marketing: 'Marketing',
	design: 'Design & content',
	payments: 'Payments & finance',
	search: 'Search & web',
	ai: 'AI & ML',
	automation: 'Automation',
	other: 'Other'
};

/** Order of the category chips (unknown categories go last, alphabetically) */
const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS);

export const categoryLabel = (category: string) =>
	CATEGORY_LABELS[category] ??
	category.replace(/-/g, ' ').replace(/^\w/, (c) => c.toLocaleUpperCase('en'));

/** "Sign in with Linear" / "API key" / "No sign-in": what adding the server asks of the user */
export function authHint(authType: DirectoryEntry['authType'], service: string) {
	if (authType === 'oauth')
		return {
			label: `Sign in with ${service}`,
			description: `You sign in with your ${service} account; Toolkien keeps the access encrypted and refreshes it.`
		};
	if (authType === 'token')
		return {
			label: 'API key',
			description: `You paste a ${service} API key or access token; Toolkien stores it encrypted.`
		};
	return { label: 'No sign-in', description: 'Public server: nothing to sign in to.' };
}

/** Label of the primary "Add" button: says what comes next */
export const addLabel = (authType: DirectoryEntry['authType'], service: string) =>
	authType === 'oauth'
		? `Add and sign in with ${service}`
		: authType === 'token'
			? 'Add and paste API key'
			: 'Add';

/** `''` = all, `popular` = featured, else a category */
export type DirectoryFilter = string;
export const POPULAR = 'popular';

const normalize = (value: string) =>
	value.toLocaleLowerCase('en').normalize('NFKD').replace(/[̀-ͯ]/g, '');

/**
 * Entries matching the search (name, tagline, description, tags, category) and the filter,
 * popular ones first, then by name.
 */
export function filterDirectory<T extends DirectoryItem>(
	entries: T[],
	{ search = '', filter = '' }: { search?: string; filter?: DirectoryFilter }
): T[] {
	const terms = normalize(search).split(/\s+/).filter(Boolean);
	return entries
		.filter((entry) => {
			if (filter === POPULAR && !entry.popular) return false;
			if (filter && filter !== POPULAR && entry.category !== filter) return false;
			if (terms.length === 0) return true;
			const haystack = normalize(
				[
					entry.name,
					entry.tagline ?? '',
					entry.description,
					entry.tags.join(' '),
					categoryLabel(entry.category)
				].join(' ')
			);
			return terms.every((term) => haystack.includes(term));
		})
		.sort((a, b) => Number(b.popular) - Number(a.popular) || a.name.localeCompare(b.name, 'en'));
}

export type FilterChip = { value: DirectoryFilter; label: string; count: number };

/** Chips above the grid: All, Popular, then each category present, with counts */
export function directoryFilters(entries: DirectoryItem[]): FilterChip[] {
	const counts = new Map<string, number>();
	for (const entry of entries) counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
	const rank = (category: string) => {
		const index = CATEGORY_ORDER.indexOf(category);
		return index === -1 ? CATEGORY_ORDER.length : index;
	};
	const categories = [...counts.keys()].sort(
		(a, b) => rank(a) - rank(b) || a.localeCompare(b, 'en')
	);
	const popular = entries.filter((entry) => entry.popular).length;
	return [
		{ value: '', label: 'All', count: entries.length },
		...(popular > 0 ? [{ value: POPULAR, label: 'Popular', count: popular }] : []),
		...categories.map((value) => ({
			value,
			label: categoryLabel(value),
			count: counts.get(value)!
		}))
	];
}
