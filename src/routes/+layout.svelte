<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { brand } from '#lib/brand.ts';
	import displayFont from '#lib/assets/fonts/fraunces-latin-opsz-wght.woff2?url';
	import { BRAND_HEX } from '#lib/components/brand/paths.ts';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<!-- Served URLs (not inlined data URIs) so search engines can fetch the favicon -->
	<link rel="icon" href="/icon.svg" type="image/svg+xml" />
	<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
	<link rel="manifest" href="/site.webmanifest" />
	<meta name="theme-color" content={BRAND_HEX.paper} media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content={BRAND_HEX.ink} media="(prefers-color-scheme: dark)" />
	<!-- The display face is used above the fold on the site, auth and error pages -->
	<link rel="preload" href={displayFont} as="font" type="font/woff2" crossorigin="anonymous" />
	<title>{brand.name}</title>
</svelte:head>

<!-- The initial mode script lives in app.html so it can carry the CSP nonce -->
<ModeWatcher disableHeadScriptInjection />
<Tooltip.Provider delayDuration={300}>{@render children()}</Tooltip.Provider>
<Toaster />
