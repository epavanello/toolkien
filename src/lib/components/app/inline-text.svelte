<script lang="ts">
	import { inlineSegments } from '#lib/core/mcp-clients.ts';

	/**
	 * A sentence with light inline markup: `**UI label**` in bold, `` `command` `` in monospace.
	 * For instruction texts that live in data files (client guides), not for user content.
	 */
	let { text }: { text: string } = $props();
</script>

{#each inlineSegments(text) as segment, index (index)}
	{#if segment.kind === 'strong'}<strong class="font-medium text-foreground">{segment.text}</strong
		>{:else if segment.kind === 'code'}<code
			class="rounded-sm bg-muted px-1 py-px mono text-[0.85em] text-foreground">{segment.text}</code
		>{:else}{segment.text}{/if}
{/each}
