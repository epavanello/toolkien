/**
 * Portable tool search: one lowercased text per tool (`tool_search_text`), matched with
 * `LIKE '%word%'` for any query word (a tool matching one word is a hit), ranked here by how many
 * words it matches. No FTS5: Turso in MVCC mode rejects virtual tables, and the same SQL must run
 * on local SQLite.
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

/**
 * Query word as matched: a plural `s` is dropped (`posts` → `post`, `rules` → `rule`; not
 * `access`), so `posts` also finds `listPost`. A stem is a prefix of the word: no match is lost.
 */
export function stem(word: string): string {
	return word.length > 3 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
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

/** How many of `stems` begin one of `candidates` */
const hits = (stems: string[], candidates: string[]) =>
	stems.filter((s) => candidates.some((w) => w.startsWith(s))).length;

/**
 * Relevance of a hit (higher is better): every query word that begins a word of the tool name
 * counts 2, every query word that begins a word of its search text counts 1. A query of many
 * words therefore ranks the tools matching most of them, by name first, without requiring all.
 * Hits matched only inside a word (`wiki` in `deepwiki`) score 0 and come last.
 */
export function score(
	s: Pick<SearchSource, 'path' | 'namespace' | 'upstreamName'>,
	text: string,
	query: string[]
): number {
	const stems = [...new Set(query.map(stem))];
	const name = [...words(functionName(s)), ...words(s.upstreamName)];
	return 2 * hits(stems, name) + hits(stems, text.split(' '));
}

/**
 * Tie-break between hits of equal `score` (lower is better): 0 exact name, 1 name prefix,
 * 2 every query word in the name, 3 every query word in name, namespace, connector name or
 * label, 4 otherwise (title, description, tags, or not every query word matched).
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
