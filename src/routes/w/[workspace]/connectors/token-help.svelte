<script lang="ts">
	import { Callout } from '#lib/components/app/index.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getConnector } from '#lib/functions/connectors.remote.ts';

	/** Where to create the token, from the directory entry: the hint and a link to the right page */
	let { workspace, id }: { workspace: string; id: string } = $props();
</script>

<!-- Optional help: nothing while loading, nothing if it fails -->
<svelte:boundary>
	{@const directory = (await getConnector({ workspace, id })).directory}
	{#if directory?.tokenHelp || directory?.tokenUrl}
		<Callout title="Where to get the token" description={directory.tokenHelp}>
			{#snippet action()}
				{#if directory.tokenUrl}
					<Button
						size="sm"
						variant="outline"
						href={directory.tokenUrl}
						target="_blank"
						rel="noopener noreferrer">Create token</Button
					>
				{/if}
			{/snippet}
		</Callout>
	{/if}

	{#snippet pending()}{/snippet}
	{#snippet failed()}{/snippet}
</svelte:boundary>
