<script lang="ts">
	import { FocusFrame } from '#lib/components/app/index.ts';
	import SeoHead from '#lib/components/seo/seo-head.svelte';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<SeoHead title="Platform admin" noindex />
<FocusFrame>{@render children()}</FocusFrame>
