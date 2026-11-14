<script lang="ts">
	import { FocusFrame } from '#lib/components/app/index.ts';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<FocusFrame>{@render children()}</FocusFrame>
