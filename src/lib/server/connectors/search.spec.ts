import { describe, expect, it } from 'vitest';
import { likePattern, MAX_QUERY_WORDS, queryWords, rank, searchText, words } from './search.ts';

const posthog = {
	path: 'posthogDevmotion.runQuery',
	namespace: 'posthogDevmotion',
	upstreamName: 'run_query',
	connectorName: 'PostHog',
	label: 'DevMotion',
	title: null,
	description: 'Run a HogQL query.\nSecond line is not indexed.'
};

describe('tool search helpers', () => {
	it('splits camelCase, snake_case, acronyms and punctuation into lowercase words', () => {
		expect(words('gmail.searchThreads')).toEqual(['gmail', 'search', 'threads']);
		expect(words('search_threads')).toEqual(['search', 'threads']);
		expect(words('getHTTPResponse v2')).toEqual(['get', 'http', 'response', 'v2']);
		expect(words('Café crème')).toEqual(['café', 'crème']);
		expect(words(null)).toEqual([]);
	});

	it('builds the search text from name, instance, first description line and tags', () => {
		const text = searchText({ ...posthog, tags: ['analytics'] });
		expect(text.split(' ')).toEqual(
			expect.arrayContaining([
				'run',
				'query',
				'runquery',
				'posthog',
				'devmotion',
				'posthogdevmotion',
				'hogql',
				'hog',
				'ql',
				'analytics'
			])
		);
		expect(text).not.toContain('second');
		expect(text).toBe(text.toLowerCase());
		// Deduplicated words
		expect(text.split(' ').filter((w) => w === 'query')).toHaveLength(1);
	});

	it('tokenizes queries, drops stopwords unless nothing else is left, caps the word count', () => {
		expect(queryWords('Send an email to the team')).toEqual(['send', 'email', 'team']);
		expect(queryWords('searchThreads search')).toEqual(['search', 'threads']);
		expect(queryWords('the')).toEqual(['the']);
		expect(queryWords('  %_ ')).toEqual([]);
		expect(queryWords(Array.from({ length: 20 }, (_, i) => `w${i}`).join(' '))).toHaveLength(
			MAX_QUERY_WORDS
		);
	});

	it('escapes LIKE wildcards', () => {
		expect(likePattern('issues')).toBe('%issues%');
		expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
	});

	it('ranks exact name > name prefix > name words > instance > description', () => {
		expect(rank(posthog, ['run', 'query'])).toBe(0);
		expect(rank(posthog, ['runquery'])).toBe(0);
		expect(rank(posthog, ['posthog', 'devmotion', 'run', 'query'])).toBe(0);
		expect(rank(posthog, ['run'])).toBe(1);
		expect(rank(posthog, ['query'])).toBe(2);
		expect(rank(posthog, ['devmotion'])).toBe(3);
		expect(rank(posthog, ['devmotion', 'query'])).toBe(3);
		expect(rank(posthog, ['hogql'])).toBe(4);
	});
});
