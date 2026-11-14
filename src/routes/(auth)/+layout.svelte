<script lang="ts">
	import { resolve } from '$app/paths';
	import { brand } from '#lib/brand.ts';
	import { AuthFrame } from '#lib/components/app/index.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<AuthFrame home={resolve('/(marketing)')} tagline={brand.tagline}>{@render children()}</AuthFrame>
