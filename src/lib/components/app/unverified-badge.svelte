<script lang="ts">
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Tooltip from '#lib/components/ui/tooltip/index.js';
</script>

<!-- Marks connectors added from a free URL: their tool descriptions are untrusted -->
<Tooltip.Root>
	<Tooltip.Trigger>
		{#snippet child({ props })}
			<Badge variant="warning" class="rounded-sm" tabindex={0} {...props}>
				<TriangleAlert data-icon="inline-start" />
				Unverified
			</Badge>
		{/snippet}
	</Tooltip.Trigger>
	<Tooltip.Content
		>Added from a URL outside the curated directory. Review its tools.</Tooltip.Content
	>
</Tooltip.Root>
