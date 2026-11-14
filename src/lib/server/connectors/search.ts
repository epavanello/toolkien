/**
 * Portable tool search: one lowercased text per tool (`tool_search_text`), matched with
 * `LIKE '%word%'` for every query word (all must match), ranked here. No FTS5: Turso in MVCC
 * mode rejects virtual tables, and the same SQL must run on local SQLite.
 */

/** Query words dropped unless the query has nothing else ("list issues of a repo") */
const STOPWORDS = new Set(
	'a an and are as at by for from how i in into is it me my of on or the this to with'.split(' ')
);

/** At most this many query words are matched (longer queries are cut) */
export const MAX_QUERY_WORDS = 12;

/** `gmail.searchThreads`, `search_threads`, `Search Threads` → `gmail search threads` … */
export function words(text: string | null | undefined): string[] {
	if (!text) return [];
	return (
		text
			.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
			.replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
			.toLowerCase()
			.match(/[\p{L}\p{N}]+/gu) ?? []
	);
}

/** `words` plus each unsplit run (`HogQL` → `hogql hog ql`), so both spellings match */
function indexWords(text: string | null | undefined): string[] {
	if (!text) return [];
	return (text.match(/[\p{L}\p{N}]+/gu) ?? []).flatMap((run) => [run.toLowerCase(), ...words(run)]);
}

/** Query → distinct words to match, stopwords dropped unless nothing else is left */
export function queryWords(query: string): string[] {
	const all = [...new Set(words(query))];
	const meaningful = all.filter((w) => !STOPWORDS.has(w));
	return (meaningful.length > 0 ? meaningful : all).slice(0, MAX_QUERY_WORDS);
}

/** `LIKE` pattern matching `word` anywhere, `%` `_` `\` escaped (use with `ESCAPE '\'`) */
export function likePattern(word: string): string {
	return `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export type SearchSource = {
	path: string;
	namespace: string;
	upstreamName: string;
	connectorName: string;
	/** Instance label (`DevMotion`) */
	label: string | null;
	title: string | null;
	description: string | null;
	/** Directory tags of the connector */
	tags?: readonly string[];
};

const join = (...parts: (string | null | undefined)[][]) =>
	[...new Set(parts.flat().filter((w): w is string => !!w))].join(' ');

const functionName = (s: Pick<SearchSource, 'path' | 'namespace'>) =>
	s.path.slice(s.namespace.length + 1);

/** The stored search text: every searchable word of the tool, deduplicated, space-separated */
export function searchText(s: SearchSource): string {
	const firstLine = (s.description ?? '').trim().split('\n')[0];
	return join(
		indexWords(functionName(s)),
		indexWords(s.upstreamName),
		indexWords(s.namespace),
		indexWords(s.connectorName),
		indexWords(s.label),
		indexWords(s.title),
		indexWords(firstLine),
		(s.tags ?? []).flatMap(indexWords)
	);
}

/**
 * Rank of a tool that matched every query word (lower is better): 0 exact name, 1 name prefix,
 * 2 every word in the name, 3 every word in name, namespace, connector name or label,
 * 4 otherwise (title, description, tags).
 */
export function rank(
	s: Pick<SearchSource, 'path' | 'namespace' | 'upstreamName' | 'connectorName' | 'label'>,
	query: string[]
): number {
	// Compared without spaces: `run query`, `runQuery`, `run_query` and `runquery` are one name
	const phrase = query.join('');
	const names = [words(functionName(s)), words(s.upstreamName)];
	const compact = names.map((n) => n.join(''));
	if (compact.includes(phrase) || words(s.path).join('') === phrase) return 0;
	if (compact.some((name) => name.startsWith(phrase))) return 1;
	const name = names.flat().join(' ');
	if (query.every((w) => name.includes(w))) return 2;
	const context = join(words(name), words(s.namespace), words(s.connectorName), words(s.label));
	if (query.every((w) => context.includes(w))) return 3;
	return 4;
}
