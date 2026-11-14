import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { docsOgImage, docsOgSlug } from '#lib/components/seo/og.ts';
import { DOCS_PAGES } from './nav.ts';

describe('docs Open Graph cards', () => {
	it('maps docs paths to card slugs', () => {
		expect(docsOgSlug('/docs')).toBe('index');
		expect(docsOgSlug('/docs/')).toBe('index');
		expect(docsOgSlug('/docs/self-hosting')).toBe('self-hosting');
	});

	it('has a rendered card for every docs page (run `node scripts/brand-images.ts`)', () => {
		for (const page of DOCS_PAGES) {
			expect(existsSync(join(process.cwd(), 'static', docsOgImage(page.href)))).toBe(true);
		}
	});
});
