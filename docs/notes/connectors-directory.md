# Connectors: directory (notes for the integrator)

- **Content**: 100 entries in `directory/servers/` (17 re-checked, 83 new), each with an icon in `directory/icons/` made by `scripts/directory-icon.ts` from the vendor's own favicon. Probed on 2026-11-14 (unauthenticated `initialize`, RFC 9728 + RFC 8414 metadata); left-out servers and why: `docs/notes/directory-candidates.md`.
- **Schema (additive)**: `tagline`, `examples`, `popular`; categories `cloud`, `security`, `productivity`, `automation`, `crm`, `marketing`, `ai`. `schema.json` regenerated. `isSupportedEntry()` = not "OAuth with pre-registered clients only".
- **Contract (additive)**: `DirectoryEntry` gains `tagline?`, `examples`, `popular`, `supported`. `#lib/server/connectors/index.ts` also exports `getDirectoryEntry` and `directoryShowcase()`.
- **Remote function**: `getDirectoryAddTargets(directoryId)` (connectors.remote.ts): the user's workspaces, personal first, with add rights and existing instances.
- **Library (additive)**: app `AuthHint`, `CategoryFilter`, `ServiceCard`, `ServiceDetails`, `DirectoryBrowser`, `service-directory.ts` (labels, filtering, `addLabel`); marketing `MarketingPage`, `AddServerCard`, `DirectoryShowcase`. `SourceBadge` got `tooltips={false}`; `Callout` actions now wrap (fixes a 390 px overflow).
- **Public routes**: `/directory` (SEO + JSON-LD `ItemList`, in the sitemap and header/footer links) and `/directory/[id]/add` (signed out → `/signup?redirectTo=…`; signed in → confirm + the usual `addConnector` form, so a GET never adds anything).
- **Landing**: place `<DirectoryShowcase servers={data.directory.servers} total={data.directory.total} />` with `directory: directoryShowcase()` from `#lib/server/connectors/index.ts` in the landing load.
- **Follow-up for foundation**: the "Sign in" / "Create one" cross-links on `/login` and `/signup` drop `redirectTo`.
