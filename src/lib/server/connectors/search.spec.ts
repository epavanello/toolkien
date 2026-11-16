import { describe, expect, it } from 'vitest';
import {
	likePattern,
	MAX_QUERY_WORDS,
	queryWords,
	rank,
	score,
	searchText,
	stem,
	words
} from './search.ts';

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

	it('drops a plural s from query words', () => {
		expect(['posts', 'rules', 'comments', 'access', 'gas', 'post'].map(stem)).toEqual([
			'post',
			'rule',
			'comment',
			'access',
			'gas',
			'post'
		]);
	});

	it('scores by query words matched, name words counting double', () => {
		const tool = (upstreamName: string, description: string) => {
			const source = {
				path: `devPost.${words(upstreamName)
					.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w))
					.join('')}`,
				namespace: 'devPost',
				upstreamName,
				connectorName: 'DevPost',
				label: null,
				title: null,
				description
			};
			return (query: string) => score(source, searchText(source), queryWords(query));
		};
		const comments = tool('reddit_get_post_comments', 'Get the comment tree of a Reddit post.');
		const rules = tool('reddit_get_subreddit_rules', 'Get the posting rules of a subreddit.');
		const scan = tool('run_growth_scan', 'Scan Reddit for posts, comments and subreddit threads.');
		const query = 'reddit get post comments subreddit rules list posts';
		expect(comments(query)).toBeGreaterThan(scan(query));
		expect(rules(query)).toBeGreaterThan(scan(query));
		expect(comments('reddit post comments subreddit')).toBeGreaterThan(
			scan('reddit post comments subreddit')
		);
		expect(comments('xyzzy')).toBe(0);
		// Inside a word (`edit` in `reddit`) is no word match
		expect(comments('edit')).toBe(0);
	});
});
