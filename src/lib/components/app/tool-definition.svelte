<script lang="ts" module>
	import type { ToolAnnotations } from '#lib/server/db/schema/connectors.ts';

	export type ToolDefinitionItem = {
		path: string;
		summary: string;
		/** `.d.ts` declaration (shown in mono) */
		declaration: string;
		annotations: ToolAnnotations | null;
		version: number;
		unverified?: boolean;
		/** The description changed in the latest version (tool-poisoning warning) */
		descriptionChanged?: boolean;
		removed?: boolean;
		/** Reviewer note from the curated directory */
		note?: string | null;
	};
</script>

<script lang="ts">
	import { tv } from 'tailwind-variants';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import CodeBlock from './code-block.svelte';
	import ToolPath from './tool-path.svelte';

	/**
	 * One upstream tool as an agent sees it: path, annotation hints, one-line summary, reviewer
	 * note, change warnings and the generated TypeScript signature. Rows of a list inside a
	 * `Section variant="flush"`.
	 */
	let { tool }: { tool: ToolDefinitionItem } = $props();

	const styles = tv({
		slots: {
			root: 'flex flex-col gap-2 border-b px-4 py-3 last:border-b-0',
			header: 'flex flex-wrap items-center gap-1.5',
			text: 'text-sm text-muted-foreground',
			warning: 'text-sm text-warning'
		},
		variants: { removed: { true: { root: 'opacity-60' } } }
	});
	const s = $derived(styles({ removed: !!tool.removed }));

	const hints = $derived(
		[
			tool.annotations?.readOnlyHint === true && {
				label: 'Read only',
				variant: 'success' as const
			},
			tool.annotations?.destructiveHint === true &&
				tool.annotations.readOnlyHint !== true && {
					label: 'Destructive',
					variant: 'destructive' as const
				},
			tool.annotations?.idempotentHint === true && {
				label: 'Idempotent',
				variant: 'outline' as const
			},
			tool.annotations?.openWorldHint === true && {
				label: 'Open world',
				variant: 'outline' as const
			},
			!tool.annotations && {
				label: 'No annotations · treated as write',
				variant: 'outline' as const
			}
		].filter((hint) => !!hint)
	);
</script>

<article class={s.root()} data-slot="tool-definition">
	<div class={s.header()}>
		<ToolPath path={tool.path} unverified={tool.unverified} copy />
		{#each hints as hint (hint.label)}
			<Badge variant={hint.variant} class="rounded-sm">{hint.label}</Badge>
		{/each}
		<Badge variant="outline" class="rounded-sm">v{tool.version}</Badge>
		{#if tool.removed}<Badge variant="secondary" class="rounded-sm">Removed upstream</Badge>{/if}
	</div>
	<p class={s.text()}>{tool.summary}</p>
	{#if tool.descriptionChanged}
		<p class={s.warning()} role="status">
			The description changed in the latest version. Review it before trusting this tool.
		</p>
	{/if}
	{#if tool.note}<p class={s.text()}>Reviewer note: {tool.note}</p>{/if}
	<CodeBlock code={tool.declaration} />
</article>
