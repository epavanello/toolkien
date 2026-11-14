<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import { brand } from '#lib/brand.ts';
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
	<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#0a0a0a" media="(prefers-color-scheme: dark)" />
	<title>{brand.name}</title>
</svelte:head>

<!-- The initial mode script lives in app.html so it can carry the CSP nonce -->
<ModeWatcher disableHeadScriptInjection />
<Tooltip.Provider delayDuration={300}>{@render children()}</Tooltip.Provider>
<Toaster />
