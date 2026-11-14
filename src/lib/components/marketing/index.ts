/**
 * Public site components (landing, docs frame). Same tokens as the app, with the brand's display
 * face, hallmarks and art (docs/brand.md); pages pass data.
 */
export {
	default as Compare,
	type CompareMetric,
	type ComparePanel,
	type CompareVisual
} from './compare.svelte';
export { default as DocsShell } from './docs-shell.svelte';
export { default as FeatureGrid } from './feature-grid.svelte';
export { default as Hallmark } from './hallmark.svelte';
export { default as Hero } from './hero.svelte';
export { default as MarketingSection } from './marketing-section.svelte';
export { default as PathCards, type PathCard } from './path-cards.svelte';
export { default as ProofStrip } from './proof-strip.svelte';
export { default as SiteFooter } from './site-footer.svelte';
export { default as SiteHeader } from './site-header.svelte';
export { default as Steps } from './steps.svelte';
export type { Feature, SiteLink, SiteLinkGroup } from './types.ts';
// Server directory (connectors): public page frame, "Add to Toolkien" step, landing band
export { default as AddServerCard } from './add-server-card.svelte';
export { default as DirectoryShowcase } from './directory-showcase.svelte';
export { default as MarketingPage } from './marketing-page.svelte';
