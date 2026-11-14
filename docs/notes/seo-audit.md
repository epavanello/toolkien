# SEO / GEO and error pages audit (2026-11-14)

Checked on the live site (curl) and on a local production build (`pnpm build` + `node build`).

## Error pages

- [x] Root `src/routes/+error.svelte` (inside `FocusFrame`) built from the new library component `ErrorState` (`#lib/components/app`, variants `screen` / `section`; copy from the pure `describeError()`, specced). Covers 404, 401 (sign-in link with `redirectTo`), 403 / policy, suspended, 400, 429, 503, 5xx and offline; actions: try again (transient), home, go back, docs.
- [x] `(marketing)/+error.svelte`: site errors (e.g. `/legal/nope`) keep header and footer.
- [x] `w/[workspace]/+error.svelte`: section errors render inside the workspace shell, with a "Workspace home" link. Errors of the workspace layout itself fall back to the root page (layout not edited).
- [x] `src/error.html`: styled last-resort page (no scripts, no assets).
- [x] `handleError` (server): unknown errors get an 8-char reference id, logged with method + path (no query string) and shown on the 5xx page; message stays `Internal error` (real message only in dev). `App.Error.id?` added (additive).
- [x] `hooks.client.ts`: client navigation errors carry a `code`; offline navigation becomes 503 `UNAVAILABLE` → "You are offline".
- [x] Unknown routes return a real 404; `/mcp/**`, `/api/**` (outside Better Auth) and `/.well-known/**` unknown paths return a JSON 404 instead of HTML. MCP handlers already answer JSON (405 GET, 401 JSON-RPC without bearer).

## Indexing

- [x] `X-Robots-Tag: noindex, nofollow` on every error response and on app surfaces (`/w/`, `/admin`, `/approve`, `/invite/`, `/consent`, `/login/confirm`, `/connectors/oauth/`, `/api/`, `/mcp`); same list feeds `robots.txt` (`#lib/server/robots.ts`, specced). Consent had no noindex before.
- [x] Error pages also set `<meta name="robots" content="noindex">`. App pages (`Page`) already did.
- [x] `robots.txt`, `llms.txt`, `llms-full.txt` present and complete (all docs + legal).
- [x] `sitemap.xml`: all docs + legal + landing + signup; `lastmod` from each page's `updated` frontmatter (test enforces it); `/` matches its canonical (`origin/`).

## Head and metadata

- [x] Unique titles: `/login` and `/signup` showed "Sign in" without the brand (`AuthHeading` overrode `SeoHead`), app pages too (`Page`): both now append `· Toolkien`. Legal "Security" duplicated docs "Security": renamed "Service security" (test enforces unique titles).
- [x] Canonical from the request origin (= `ORIGIN` with adapter-node), query stripped.
- [x] OG/Twitter image: static `static/og.png` (1200×630) rendered with the Playwright Chromium already installed (`node scripts/brand-images.ts`, Inter font, brand tokens); default in `SeoHead` with alt/size, `summary_large_image`. Chosen over an `og` SVG route because most platforms do not render SVG OG images.
- [x] Favicon now a crawlable URL (`/icon.svg`, was a data URI), `apple-touch-icon.png`, manifest linked, PNG 192/512 + maskable icons in the manifest, `theme-color` light/dark.
- [x] JSON-LD: valid (parsed); docs `TechArticle`, legal `WebPage`, both with `url`, `image`, `inLanguage`, `isPartOf` and a `BreadcrumbList`; landing `SoftwareApplication` + `WebSite` with `image`.
- [x] `<html lang="en">`, one `<h1>` per page, no heading level skips in docs/legal markdown, no "click here" link texts.
- [x] Trailing slash: `/docs/` → 308 `/docs` (consistent, canonical without slash).
- [x] Missing docs/legal slugs → 404.

## Left, with reason

- [ ] Prerendering marketing/docs: not safe. The `(marketing)` layout reads the session (`signedIn` header button), `/` redirects signed-in users, and canonical/OG URLs come from the runtime `ORIGIN` (self-hosters build once, deploy on any domain). Instead: signed-out landing/docs/legal get `Cache-Control: private, max-age=300` + `Vary: Cookie` (private because every response carries its own CSP nonce).
- [ ] Docs prerender would also need the docs layout/nav (excluded files for this pass).
- [ ] `/favicon.ico` still 404 (browsers use the declared SVG; harmless).
- [ ] `/api/auth/**` unknown paths: Better Auth answers an empty 404 (not ours to wrap).
- [ ] OG image is generic for every page (no per-page cards: would need a renderer dependency).
