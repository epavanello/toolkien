/**
 * Open Graph cards rendered by `scripts/brand-images.ts` (1200×630 PNGs in `static/`): the brand
 * card for every page, plus one card per docs page with its title on the brand background.
 */

/** The brand card (landing, legal, auth, fallback) */
export const DEFAULT_OG_IMAGE = '/og.png';

/** Folder of per-page cards; same size and type as the default card */
export const OG_PREFIX = '/og/';

/** `/docs` → `index`, `/docs/self-hosting` → `self-hosting` */
export const docsOgSlug = (pathname: string) =>
	pathname.replace(/\/$/, '').replace(/^\/docs\/?/, '') || 'index';

/** Card of a docs page (the script renders one for every entry of the docs nav) */
export const docsOgImage = (pathname: string) => `${OG_PREFIX}docs/${docsOgSlug(pathname)}.png`;
