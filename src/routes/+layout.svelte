<script lang="ts">
	import './layout.css';
	import { ModeWatcher } from 'mode-watcher';
	import favicon from '#lib/assets/favicon.svg';
	import { brand } from '#lib/brand.ts';
	import { Toaster } from '#lib/components/ui/sonner/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>{brand.name}</title>
</svelte:head>

<!-- The initial mode script lives in app.html so it can carry the CSP nonce -->
<ModeWatcher disableHeadScriptInjection />
<Tooltip.Provider delayDuration={300}>{@render children()}</Tooltip.Provider>
<Toaster />
