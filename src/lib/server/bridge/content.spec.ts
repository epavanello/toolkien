import { describe, expect, it } from 'vitest';
import { argumentsFields, argumentsPreview, hashArgs, stableStringify } from './content.ts';

describe('bridge content helpers', () => {
	it('hashes arguments independently of key order', () => {
		expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
		expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
		expect(hashArgs({ a: 1 })).not.toBe(hashArgs({ a: 2 }));
		expect(hashArgs({ a: 1, b: undefined })).toBe(hashArgs({ a: 1 }));
	});

	it('previews the main arguments, clipped', () => {
		expect(argumentsPreview(undefined)).toBe('(no arguments)');
		expect(argumentsPreview({ to: 'a@b.c', body: 'x'.repeat(1000) })).toMatch(
			/^to: a@b\.c\nbody: x{299}…$/
		);
		const many = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`k${i}`, i]));
		expect(argumentsPreview(many).split('\n')).toHaveLength(21);
		expect(argumentsPreview([1, 2])).toBe('[1,2]');
	});

	it('structures the arguments for the approval page', () => {
		expect(argumentsFields(undefined)).toBeNull();
		expect(argumentsFields({ a: undefined })).toBeNull();
		const url = 'https://github.com/o/r/tree/feat/' + 'x'.repeat(500);
		expect(
			argumentsFields({
				page_id: 'p1',
				allow_async: false,
				properties: { Branch: url, Count: 3 },
				encoded: '{"Pull Request":"https://github.com/o/r/pull/1"}',
				tags: ['a', 'b']
			})
		).toEqual({
			kind: 'fields',
			more: 0,
			fields: [
				{ key: 'page_id', value: { kind: 'text', text: 'p1' } },
				{ key: 'allow_async', value: { kind: 'text', text: 'false' } },
				{
					key: 'properties',
					value: {
						kind: 'fields',
						more: 0,
						fields: [
							// Not clipped at the one-line preview's 300 characters
							{ key: 'Branch', value: { kind: 'text', text: url } },
							{ key: 'Count', value: { kind: 'text', text: '3' } }
						]
					}
				},
				{
					key: 'encoded',
					value: {
						kind: 'fields',
						more: 0,
						fields: [
							{
								key: 'Pull Request',
								value: { kind: 'text', text: 'https://github.com/o/r/pull/1' }
							}
						]
					}
				},
				{ key: 'tags', value: { kind: 'json', text: '[\n  "a",\n  "b"\n]' } }
			]
		});
		// Deep values and long lists stay bounded
		const deep = argumentsFields({ a: { b: { c: { d: 1 } } } });
		expect(JSON.stringify(deep)).toContain('"kind":"json","text":"{\\n  \\"d\\": 1\\n}"');
		const many = argumentsFields(
			Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`k${i}`, i]))
		);
		expect(many).toMatchObject({ kind: 'fields', more: 10 });
		expect(argumentsFields('not json {')).toEqual({ kind: 'text', text: 'not json {' });
	});
});
