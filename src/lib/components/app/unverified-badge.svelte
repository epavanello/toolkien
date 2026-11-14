<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';

	/**
	 * Marks something whose self-description cannot be trusted: connectors added from a free URL
	 * (default text) or, with `tooltip`, e.g. MCP clients that registered dynamically.
	 */
	let {
		tooltip = 'Added from a URL outside the curated directory. Review its tools.'
	}: { tooltip?: string } = $props();
</script>

<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<Badge variant="warning" class="rounded-sm" tabindex={0} {...props}>
				<TriangleAlert data-icon="inline-start" />
				Unverified
			</Badge>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content>{tooltip}</Tooltip.Content>
</Tooltip.Root>
